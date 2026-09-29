import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, normalizeGradeLevel, normalizePassFail, normalizePayload } from '../src/workflow.js';

const baseConfig = {
  skipDuplicates: true,
  unmatchedStudentMode: 'park',
  brillium: { teacherNameField: 'CUST3', schoolNameField: 'CUST2', gradeLevelField: 'CUST4' }
};

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const webhookBody = {
  AID: 'A0HVYA4P6JF7',
  GUID: 'A9663FEB4B3A4BEBA1A6D2E7B92C2525',
  GRADE: '80',
  PASSFAIL: 'Pass',
  EMAIL: 'Student@Example.com',
  FNAME: 'Gregory',
  LNAME: 'Kulikov',
  CUST2: 'Example High School',
  CUST3: 'Alyssa Parker',
  CUST4: '11th'
};

function makeDeps(overrides = {}) {
  const calls = { records: [], students: [], updates: [], notifications: [] };

  const deps = {
    config: baseConfig,
    logger: silentLogger,
    attemptDate: () => '2026-09-28',
    semesterFor: () => 'Fall 2026',
    brillium: {
      getAssessment: async () => ({ Name: 'TN FW Module 1 Quiz', PassingScore: 70 }),
      getRespondent: async () => ({ Attempt: 9, TimesTaken: 9, FinalScore: '80', PassFail: 'Pass' })
    },
    airtable: {
      findStudentByEmail: async () => ({
        id: 'recdCAFQMi8BPyDfE',
        fields: {
          'Student Name': 'Gregory Kulikov',
          Email: 'student@example.com',
          Teacher: ['rec98w3s3zQd55kA2'],
          'Grade Level': '11th'
        }
      }),
      findStudentByName: async () => null,
      findTeacherByName: async () => null,
      getTeacher: async (id) => ({
        id,
        fields: {
          'Teacher Name': '  Alyssa Parker  ',
          'School Email': 'aparker@school.edu',
          'Alternate Email': 'alyssa@home.com',
          Phone: '555-0100'
        }
      }),
      createStudent: async (fields) => {
        calls.students.push(fields);
        return { id: 'recNEWSTUDENT001', fields };
      },
      updateStudent: async (id, fields) => calls.updates.push({ id, fields }),
      findExistingAttempt: async () => null,
      createStudentRecord: async (fields) => {
        calls.records.push(fields);
        return { id: 'recNEWRECORD0001', fields };
      },
      studentRecordUrl: (id) => `https://airtable.com/appwFNJwQTtBif0yT/tblNpWWDu0YSgiark/${id}`,
      firstLinkedId: (value) => (Array.isArray(value) ? value[0] ?? null : value || null)
    },
    notifier: {
      buildNotification: (input) => ({ built: true, ...input }),
      sendNotification: async (payload) => {
        calls.notifications.push(payload);
        return { sent: true };
      }
    },
    ...overrides
  };
  return { deps, calls };
}

test('normalizePayload reads Brillium keys case-insensitively', () => {
  const payload = normalizePayload({ aid: ' 12 ', Guid: 'g', EMAIL: 'A@B.com', CUST3: 'Pat' });
  assert.equal(payload.assessmentId, '12');
  assert.equal(payload.guid, 'g');
  assert.equal(payload.email, 'a@b.com');
  assert.equal(payload.get('cust3'), 'Pat');
});

test('pass/fail and grade level normalize to the select options', () => {
  assert.equal(normalizePassFail('passed'), 'Pass');
  assert.equal(normalizePassFail('F'), 'Fail');
  assert.equal(normalizePassFail('unknown'), null);
  assert.equal(normalizeGradeLevel('11TH'), '11th');
  assert.equal(normalizeGradeLevel('college'), null);
});

test('student matched by email writes a linked record row and notifies', async () => {
  const { deps, calls } = makeDeps();
  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedBy, 'email');
  assert.equal(result.program, 'TN Forest Worker');
  assert.equal(result.notified, true);

  assert.deepEqual(calls.records[0], {
    'Assessment Name': 'TN FW Module 1 Quiz',
    'Assessment ID': 'A0HVYA4P6JF7',
    'Assessment Type': 'Quiz',
    'Attempt #': '9',
    Score: '80',
    'Brillium GUID': 'A9663FEB4B3A4BEBA1A6D2E7B92C2525',
    'Attempt Date': '2026-09-28',
    Semester: 'Fall 2026',
    'Mailed or Emailed': false,
    Student: ['recdCAFQMi8BPyDfE'],
    'Teacher At Time': ['rec98w3s3zQd55kA2'],
    Program: 'TN Forest Worker',
    'Pass/Fail': 'Pass',
    'Grade Level': '11th'
  });

  const notification = calls.notifications[0];
  assert.equal(notification.status, 'matched');
  assert.equal(notification.teacher.name, 'Alyssa Parker');
  assert.equal(notification.teacher.schoolEmail, 'aparker@school.edu');
  assert.equal(notification.school, 'Example High School');
  assert.equal(notification.record.url.endsWith('recNEWRECORD0001'), true);
});

test('an exam name picks the Exam assessment type', async () => {
  const { deps, calls } = makeDeps();
  deps.brillium.getAssessment = async () => ({ Name: 'AL Forest Worker Final Exam' });

  await createWorkflow(deps).run(webhookBody);
  assert.equal(calls.records[0]['Assessment Type'], 'Exam');
  assert.equal(calls.records[0].Program, 'AL Forest Worker');
});

test('a name match repairs the missing email on the student record', async () => {
  const { deps, calls } = makeDeps();
  deps.airtable.findStudentByEmail = async () => null;
  deps.airtable.findStudentByName = async () => ({
    id: 'recBYNAME00000001',
    fields: { 'Student Name': 'Gregory Kulikov', Teacher: ['rec98w3s3zQd55kA2'] }
  });

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.matchedBy, 'name');
  assert.deepEqual(calls.updates, [
    { id: 'recBYNAME00000001', fields: { Email: 'student@example.com' } }
  ]);
  assert.equal(calls.records[0].Student[0], 'recBYNAME00000001');
});

test('an unmatched student parks the row and flags it for review', async () => {
  const { deps, calls } = makeDeps();
  deps.airtable.findStudentByEmail = async () => null;
  deps.airtable.findStudentByName = async () => null;

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.studentId, null);
  assert.equal(calls.students.length, 0);
  assert.equal(calls.records[0].Student, undefined);
  assert.equal(calls.notifications[0].status, 'needs_review');
  assert.equal(calls.notifications[0].student.name, 'Gregory Kulikov');
});

test('create mode adds the student and links the teacher from the payload', async () => {
  const { deps, calls } = makeDeps({ config: { ...baseConfig, unmatchedStudentMode: 'create' } });
  deps.airtable.findStudentByEmail = async () => null;
  deps.airtable.findStudentByName = async () => null;
  deps.airtable.findTeacherByName = async (name) => ({
    id: 'recTEACHERBYNAME1',
    fields: { 'Teacher Name': name, 'School Email': 'aparker@school.edu' }
  });

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedBy, 'created');
  assert.deepEqual(calls.students[0], {
    'Student Name': 'Gregory Kulikov',
    Email: 'student@example.com',
    'Grade Level': '11th',
    Teacher: ['recTEACHERBYNAME1']
  });
  assert.equal(calls.records[0].Student[0], 'recNEWSTUDENT001');
  assert.equal(calls.records[0]['Teacher At Time'][0], 'recTEACHERBYNAME1');
});

test('a redelivered attempt is skipped', async () => {
  const { deps, calls } = makeDeps();
  deps.airtable.findExistingAttempt = async () => ({ id: 'recEXISTING00001' });

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'duplicate');
  assert.equal(result.studentRecordId, 'recEXISTING00001');
  assert.equal(calls.records.length, 0);
  assert.equal(calls.notifications.length, 0);
});

test('dry run reports the fields without writing anything', async () => {
  const { deps, calls } = makeDeps({ config: { ...baseConfig, dryRun: true } });
  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.dryRun, true);
  assert.equal(result.studentRecordId, null);
  assert.equal(result.fields.Student[0], 'recdCAFQMi8BPyDfE');
  assert.equal(result.fields['Teacher At Time'][0], 'rec98w3s3zQd55kA2');
  assert.equal(calls.records.length, 0);
  assert.equal(calls.students.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('a payload without AID or GUID is rejected', async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => createWorkflow(deps).run({ EMAIL: 'a@b.com' }),
    /missing AID or GUID/
  );
});
