import { config as defaultConfig } from './config.js';
import { logger as defaultLogger } from './logger.js';
import { brillium as defaultBrillium } from './clients/brillium.js';
import { airtable as defaultAirtable } from './clients/airtable.js';
import { notifier as defaultNotifier } from './notifier.js';
import { attemptDate as defaultAttemptDate, semesterFor as defaultSemesterFor } from './dates.js';
import { determineAssessmentType, determineProgram } from './programs.js';
import { RECORD_FIELDS, STUDENT_FIELDS, TEACHER_FIELDS } from './airtable-schema.js';

/** Payload problems are permanent, so they answer 400 instead of asking for a retry. */
export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
    this.status = 400;
  }
}

const GRADE_LEVELS = ['7th', '8th', '9th', '10th', '11th', '12th'];

/** Brillium posts upper-case keys; read them without caring about case. */
export function normalizePayload(body = {}) {
  const lookup = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]));
  const get = (key) => {
    const value = lookup.get(String(key).toLowerCase());
    return value === undefined || value === null ? '' : String(value).trim();
  };
  return {
    get,
    assessmentId: get('AID'),
    guid: get('GUID'),
    grade: get('GRADE'),
    passFail: get('PASSFAIL'),
    email: get('EMAIL').toLowerCase(),
    firstName: get('FNAME'),
    lastName: get('LNAME'),
    raw: body
  };
}

/** The Pass/Fail column is a single select with exactly two options. */
export function normalizePassFail(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['pass', 'passed', 'p', 'true', '1', 'y', 'yes'].includes(text)) return 'Pass';
  if (['fail', 'failed', 'f', 'false', '0', 'n', 'no'].includes(text)) return 'Fail';
  return null;
}

/** Grade Level is a single select; only the known options are written. */
export function normalizeGradeLevel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return GRADE_LEVELS.find((choice) => choice.toLowerCase() === text) ?? null;
}

export function createWorkflow(deps = {}) {
  const {
    config = defaultConfig,
    logger = defaultLogger,
    brillium = defaultBrillium,
    airtable = defaultAirtable,
    notifier = defaultNotifier,
    attemptDate = defaultAttemptDate,
    semesterFor = defaultSemesterFor
  } = deps;

  async function run(body) {
    const payload = normalizePayload(body);
    if (!payload.assessmentId || !payload.guid) {
      throw new BadRequestError('Webhook payload is missing AID or GUID');
    }
    logger.info('Processing Brillium quiz webhook', {
      assessmentId: payload.assessmentId,
      guid: payload.guid
    });

    // 1. Enrich from the Brillium API.
    const [assessment, respondent] = await Promise.all([
      brillium.getAssessment(payload.assessmentId),
      brillium.getRespondent(payload.guid)
    ]);

    const assessmentName = assessment?.Name || assessment?.name || '';
    const program = determineProgram(assessmentName);
    const assessmentType = determineAssessmentType(assessmentName);

    const email = (payload.email || respondent?.Email || '').toLowerCase();
    const firstName = payload.firstName || respondent?.FirstName || '';
    const lastName = payload.lastName || respondent?.LastName || '';
    const studentName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();

    const attemptNumber = String(
      respondent?.Attempt ?? respondent?.TimesTaken ?? payload.get('ATTEMPT') ?? ''
    ).trim();
    const score = String(payload.grade || respondent?.FinalScore || '').trim();
    const passFail = normalizePassFail(payload.passFail || respondent?.PassFail);
    const date = attemptDate();
    const semester = semesterFor(date);
    const gradeLevelFromPayload = normalizeGradeLevel(payload.get(config.brillium.gradeLevelField));
    const teacherNameFromPayload = payload.get(config.brillium.teacherNameField);
    const schoolNameFromPayload = payload.get(config.brillium.schoolNameField);

    if (!assessmentName) logger.warn('Brillium returned no assessment name', { aid: payload.assessmentId });
    if (!program) logger.warn('Assessment name matched no program', { assessmentName });

    // 2. Stop if this exact attempt is already on file (Brillium redelivery).
    if (config.skipDuplicates) {
      const existing = await airtable.findExistingAttempt(payload.guid, attemptNumber);
      if (existing) {
        logger.info('Attempt already recorded, skipping', { recordId: existing.id });
        return {
          status: 'duplicate',
          studentRecordId: existing.id,
          studentRecordUrl: airtable.studentRecordUrl(existing.id)
        };
      }
    }

    // 3. Find the student, then the teacher linked to that student.
    const found = await findStudent({ email, studentName });
    let student = found.record;
    let matchedBy = found.matchedBy;

    let teacher = await findTeacher(student, teacherNameFromPayload);

    // 4. Optionally add the student so the next attempt matches on its own.
    if (!student && config.unmatchedStudentMode === 'create') {
      student = await createStudent({
        studentName,
        email,
        gradeLevel: gradeLevelFromPayload,
        teacherId: teacher?.id ?? null
      });
      matchedBy = 'created';
    }

    const gradeLevel =
      student?.fields?.[STUDENT_FIELDS.gradeLevel] || gradeLevelFromPayload || null;

    // 5. Write the row on Student Records.
    const fields = {
      [RECORD_FIELDS.assessmentName]: assessmentName,
      [RECORD_FIELDS.assessmentId]: payload.assessmentId,
      [RECORD_FIELDS.assessmentType]: assessmentType,
      [RECORD_FIELDS.attemptNumber]: attemptNumber,
      [RECORD_FIELDS.score]: score,
      [RECORD_FIELDS.brilliumGuid]: payload.guid,
      [RECORD_FIELDS.attemptDate]: date,
      [RECORD_FIELDS.semester]: semester,
      [RECORD_FIELDS.mailedOrEmailed]: false
    };
    if (student) fields[RECORD_FIELDS.student] = [student.id];
    if (teacher) fields[RECORD_FIELDS.teacherAtTime] = [teacher.id];
    if (program) fields[RECORD_FIELDS.program] = program;
    if (passFail) fields[RECORD_FIELDS.passFail] = passFail;
    if (gradeLevel) fields[RECORD_FIELDS.gradeLevel] = gradeLevel;

    const record = config.dryRun
      ? { id: null, fields, dryRun: true }
      : await airtable.createStudentRecord(fields);
    const url = record?.id ? airtable.studentRecordUrl(record.id) : null;
    if (config.dryRun) logger.info('DRY_RUN, student record not created', { fields });
    const status = student && teacher ? 'matched' : 'needs_review';
    logger.info('Created student record', { recordId: record?.id, status, matchedBy });

    // 6. Hand the result to whatever sends the teacher email.
    const notification = notifier.buildNotification({
      status,
      student: {
        recordId: student?.id ?? null,
        name: student?.fields?.[STUDENT_FIELDS.name] || studentName,
        email: student?.fields?.[STUDENT_FIELDS.email] || email,
        gradeLevel
      },
      teacher: {
        recordId: teacher?.id ?? null,
        name: String(teacher?.fields?.[TEACHER_FIELDS.name] || teacherNameFromPayload || '').trim(),
        schoolEmail: teacher?.fields?.[TEACHER_FIELDS.schoolEmail] || '',
        alternateEmail: teacher?.fields?.[TEACHER_FIELDS.alternateEmail] || '',
        phone: teacher?.fields?.[TEACHER_FIELDS.phone] || ''
      },
      school: schoolNameFromPayload,
      assessment: {
        id: payload.assessmentId,
        name: assessmentName,
        type: assessmentType,
        program,
        passingScore: assessment?.PassingScore ?? null
      },
      result: {
        score,
        passFail,
        attempt: attemptNumber,
        attemptDate: date,
        guid: payload.guid
      },
      record: { id: record?.id ?? null, url }
    });
    const delivery = await notifier.sendNotification(notification);

    return {
      status,
      matchedBy,
      program,
      assessmentName,
      studentRecordId: record?.id ?? null,
      studentRecordUrl: url,
      studentId: student?.id ?? null,
      teacherId: teacher?.id ?? null,
      notified: Boolean(delivery?.sent),
      dryRun: config.dryRun || undefined,
      fields: config.dryRun ? fields : undefined
    };
  }

  /** Email first, then name. A name match writes the email back for next time. */
  async function findStudent({ email, studentName }) {
    let record = await airtable.findStudentByEmail(email);
    if (record) return { record, matchedBy: 'email' };

    record = await airtable.findStudentByName(studentName);
    if (!record) return { record: null, matchedBy: 'none' };

    if (email && !record.fields?.[STUDENT_FIELDS.email]) {
      if (!config.dryRun) {
        await airtable.updateStudent(record.id, { [STUDENT_FIELDS.email]: email });
      }
      record.fields = { ...record.fields, [STUDENT_FIELDS.email]: email };
      logger.info('Wrote the email back onto the student record', {
        recordId: record.id,
        dryRun: config.dryRun
      });
    }
    return { record, matchedBy: 'name' };
  }

  /** The student's linked teacher, falling back to the name Brillium carries. */
  async function findTeacher(student, teacherNameFromPayload) {
    const linkedId = airtable.firstLinkedId(student?.fields?.[STUDENT_FIELDS.teacher]);
    if (linkedId) {
      const teacher = await airtable.getTeacher(linkedId);
      if (teacher) return teacher;
    }
    if (teacherNameFromPayload) {
      const teacher = await airtable.findTeacherByName(teacherNameFromPayload);
      if (teacher) {
        logger.info('Matched the teacher by name from the Brillium payload', {
          teacherName: teacherNameFromPayload
        });
        return teacher;
      }
      logger.warn('No teacher matched the name on the Brillium payload', {
        teacherName: teacherNameFromPayload
      });
    }
    return null;
  }

  async function createStudent({ studentName, email, gradeLevel, teacherId }) {
    const fields = { [STUDENT_FIELDS.name]: studentName };
    if (email) fields[STUDENT_FIELDS.email] = email;
    if (gradeLevel) fields[STUDENT_FIELDS.gradeLevel] = gradeLevel;
    if (teacherId) fields[STUDENT_FIELDS.teacher] = [teacherId];
    if (config.dryRun) {
      logger.info('DRY_RUN, student not created', { fields });
      return { id: null, fields, dryRun: true };
    }
    const record = await airtable.createStudent(fields);
    logger.info('Created student in Airtable', { recordId: record?.id, studentName });
    return record;
  }

  return { run };
}

export const workflow = createWorkflow();
