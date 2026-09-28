import { config as defaultConfig } from './config.js';
import { logger as defaultLogger } from './logger.js';
import { brillium as defaultBrillium } from './clients/brillium.js';
import { ghl as defaultGhl } from './clients/ghl.js';
import { airtable as defaultAirtable } from './clients/airtable.js';
import { mailer as defaultMailer } from './mailer.js';
import { determineProgram } from './programs.js';
import { orphanedQuizEmail, teacherResultsEmail, unlinkedQuizEmail } from './templates.js';

/** Payload problems are permanent, so they answer 400 instead of asking for a retry. */
export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
    this.status = 400;
  }
}

/** Brillium posts upper-case keys; read them without caring about case. */
export function normalizePayload(body = {}) {
  const lookup = new Map(
    Object.entries(body).map(([key, value]) => [key.toLowerCase(), value])
  );
  const get = (key) => {
    const value = lookup.get(key.toLowerCase());
    return value === undefined || value === null ? '' : String(value).trim();
  };
  return {
    assessmentId: get('AID'),
    guid: get('GUID'),
    grade: get('GRADE'),
    passFail: get('PASSFAIL'),
    email: get('EMAIL').toLowerCase(),
    firstName: get('FNAME'),
    lastName: get('LNAME'),
    gradeLevel: get('CUST4'),
    raw: body
  };
}

export function createWorkflow(deps = {}) {
  const {
    config = defaultConfig,
    logger = defaultLogger,
    brillium = defaultBrillium,
    ghl = defaultGhl,
    airtable = defaultAirtable,
    mailer = defaultMailer
  } = deps;

  async function run(body) {
    const payload = normalizePayload(body);
    if (!payload.assessmentId || !payload.guid) {
      throw new BadRequestError('Webhook payload is missing AID or GUID');
    }
    logger.info('Processing Brillium quiz webhook', {
      assessmentId: payload.assessmentId,
      guid: payload.guid,
      email: payload.email
    });

    // Steps 1-4: Brillium assessment and respondent lookups.
    const [assessment, respondent] = await Promise.all([
      brillium.getAssessment(payload.assessmentId),
      brillium.getRespondent(payload.guid)
    ]);
    const quizName = assessment?.Name || assessment?.name || '';
    const attemptNumber = respondent?.Attempt ?? respondent?.TimesTaken ?? '';
    const timesTaken = respondent?.TimesTaken ?? respondent?.Attempt ?? '';

    // Steps 5-7: find or create the CRM contact.
    let contact = await ghl.findContactByEmail(payload.email);
    let contactCreated = false;
    if (!contact) {
      contact = await ghl.createContact({
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        gradeLevel: payload.gradeLevel
      });
      contactCreated = true;
      logger.info('Created CRM contact', { contactId: contact?.id, email: payload.email });

      const mail = orphanedQuizEmail({
        studentName: ghl.contactName(contact) || `${payload.firstName} ${payload.lastName}`.trim(),
        email: payload.email,
        quizName,
        assessmentId: payload.assessmentId,
        score: payload.grade,
        passFail: payload.passFail,
        attempt: attemptNumber,
        guid: payload.guid,
        gradeLevel: payload.gradeLevel
      });
      await mailer.sendMail({ to: config.mail.maggieEmail, ...mail });
    }

    const studentName =
      ghl.contactName(contact) || `${payload.firstName} ${payload.lastName}`.trim();

    // Step 8 and its branches: map the quiz name to an FW Program.
    const program = determineProgram(quizName);
    const fwProgramFieldId = await ghl.resolveFieldId(
      config.ghl.fwProgramFieldId,
      config.ghl.fwProgramFieldName
    );
    if (program && contact?.id) {
      await ghl.updateContactCustomField(contact.id, fwProgramFieldId, program);
      logger.info('Set FW Program on contact', { contactId: contact.id, program });
    } else if (!program) {
      logger.warn('Quiz name matched no program', { quizName });
    }
    const contactProgram = program || ghl.customFieldValue(contact, fwProgramFieldId);

    // Step 17-19: ignore teacher submissions, only students continue.
    const tags = ghl.contactTags(contact);
    if (tags.includes(config.ghl.teacherTag)) {
      logger.info('Ignoring teacher submission', { contactId: contact?.id });
      return { status: 'ignored', reason: 'teacher_tag', quizName, program };
    }
    if (!tags.includes(config.ghl.studentTag)) {
      logger.warn('Contact has neither student nor teacher tag', { contactId: contact?.id, tags });
      return { status: 'ignored', reason: 'no_student_tag', quizName, program };
    }

    const context = {
      payload,
      quizName,
      attemptNumber,
      timesTaken,
      studentName,
      contactProgram,
      contactCreated,
      program
    };

    // Step 20: find the student in Airtable by email.
    let student = await airtable.findStudentByEmail(payload.email);
    let matchedBy = 'email';

    // Steps 26-27: fall back to the student name, then repair the email.
    if (!student) {
      student = await airtable.findStudentByName(studentName);
      if (student) {
        matchedBy = 'name';
        await airtable.updateStudentEmail(student.id, payload.email);
        logger.info('Repaired student email in Airtable', { recordId: student.id });
      }
    }

    if (!student) {
      // Steps 33-34: log the attempt without a teacher and tell Maggie.
      return handleUnmatchedStudent(context);
    }

    const teacherId = airtable.firstLinkedId(
      student.fields?.[config.airtable.studentTeacherField]
    );
    if (!teacherId) {
      logger.warn('Student record has no linked teacher', { recordId: student.id });
      return handleUnmatchedStudent(context, student);
    }

    // Steps 21-25: teacher lookup, attempt logging, teacher email.
    const teacher = await airtable.getTeacher(teacherId);
    const attempt = await airtable.createAttempt(
      buildAttemptFields(context, { studentRecord: student, teacherId, attempt: attemptNumber })
    );

    const teacherName = String(teacher?.fields?.['Teacher Name'] || '').trim();
    const schoolEmail = teacher?.fields?.['School Email'] || '';
    const alternateEmail = teacher?.fields?.['Alternate Email'] || '';

    const mail = teacherResultsEmail({
      teacherName,
      studentName,
      quizName,
      score: payload.grade,
      passFail: payload.passFail,
      attempt: attemptNumber
    });
    await mailer.sendMail({
      to: schoolEmail,
      cc: alternateEmail,
      bcc: config.mail.teacherBcc,
      ...mail
    });

    return {
      status: 'ok',
      matchedBy,
      quizName,
      program,
      contactId: contact?.id,
      contactCreated,
      studentRecordId: student.id,
      teacherRecordId: teacherId,
      attemptRecordId: attempt?.id,
      teacherEmail: schoolEmail
    };
  }

  function buildAttemptFields(context, { studentRecord, teacherId, attempt }) {
    const { payload, quizName, studentName, contactProgram } = context;
    const fields = {
      Student:
        config.airtable.studentAsLink && studentRecord ? [studentRecord.id] : studentName,
      Program: contactProgram,
      Semester: config.currentSemester,
      'Assessment Name': quizName,
      'Assessment ID': payload.assessmentId,
      'Attempt #': attempt,
      'Assessment Type': 'Quiz',
      'Pass/Fail': payload.passFail,
      Score: payload.grade,
      'Brillium GUID': payload.guid,
      'Mailed or Emailed': false
    };
    if (teacherId) fields['Teacher At Time'] = [teacherId];
    return fields;
  }

  async function handleUnmatchedStudent(context, studentRecord = null) {
    const { payload, quizName, timesTaken, studentName } = context;
    const attempt = await airtable.createAttempt(
      buildAttemptFields(context, { studentRecord, teacherId: null, attempt: timesTaken })
    );
    const recordUrl = attempt?.id ? airtable.attemptRecordUrl(attempt.id) : '';
    const mail = unlinkedQuizEmail({
      studentName,
      email: payload.email,
      quizName,
      assessmentId: payload.assessmentId,
      score: payload.grade,
      passFail: payload.passFail,
      attempt: timesTaken,
      guid: payload.guid,
      recordUrl
    });
    await mailer.sendMail({ to: config.mail.maggieEmail, ...mail });
    logger.warn('Logged attempt without a linked teacher', { attemptRecordId: attempt?.id });

    return {
      status: 'unlinked',
      quizName,
      program: context.program,
      contactCreated: context.contactCreated,
      studentRecordId: studentRecord?.id ?? null,
      attemptRecordId: attempt?.id,
      attemptRecordUrl: recordUrl
    };
  }

  return { run };
}

export const workflow = createWorkflow();
