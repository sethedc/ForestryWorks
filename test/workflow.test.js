import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, normalizePayload } from '../src/workflow.js';

const baseConfig = {
  currentSemester: 'Fall 2026',
  ghl: {
    fwProgramFieldId: 'fw123',
    fwProgramFieldName: 'FW Program',
    gradeLevelFieldId: 'gl123',
    gradeLevelFieldName: 'Grade Level',
    teacherTag: 'teacher',
    studentTag: 'student'
  },
  airtable: {
    studentTeacherField: 'Teacher',
    studentAsLink: false
  },
  mail: {
    maggieEmail: 'maggie@example.com',
    teacherBcc: 'maggie@example.com'
  }
};

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const webhookBody = {
  AID: '900',
  GUID: 'guid-1',
  GRADE: '88',
  PASSFAIL: 'Pass',
  EMAIL: 'Student@Example.com',
  FNAME: 'Sam',
  LNAME: 'Green',
  CUST4: '11th'
};

function makeDeps(overrides = {}) {
  const sent = [];
  const created = [];
  const updates = [];

  const deps = {
    config: baseConfig,
    logger: silentLogger,
    brillium: {
      getAssessment: async () => ({ Name: 'AL Forest Worker Quiz 3', PassingScore: 70 }),
      getRespondent: async () => ({ Attempt: 2, TimesTaken: 3 })
    },
    ghl: {
      findContactByEmail: async () => ({
        id: 'c1',
        contactName: 'Sam Green',
        email: 'student@example.com',
        tags: ['Student']
      }),
      createContact: async (input) => ({ id: 'c-new', ...input, tags: ['student'] }),
      updateContactCustomField: async (contactId, fieldId, value) => {
        updates.push({ contactId, fieldId, value });
      },
      resolveFieldId: async (explicitId) => explicitId,
      contactName: (contact) =>
        contact?.contactName || `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim(),
      contactTags: (contact) => (contact?.tags ?? []).map((tag) => tag.toLowerCase()),
      customFieldValue: () => ''
    },
    airtable: {
      findStudentByEmail: async () => ({ id: 'recS', fields: { Teacher: ['recT'] } }),
      findStudentByName: async () => null,
      updateStudentEmail: async () => ({}),
      getTeacher: async () => ({
        id: 'recT',
        fields: {
          'Teacher Name': '  Pat Jones  ',
          'School Email': 'pat@school.edu',
          'Alternate Email': 'pat@home.com'
        }
      }),
      createAttempt: async (fields) => {
        created.push(fields);
        return { id: 'recA', fields };
      },
      attemptRecordUrl: (id) => `https://airtable.com/app/tbl/${id}`,
      firstLinkedId: (value) => (Array.isArray(value) ? value[0] ?? null : value || null)
    },
    mailer: {
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'x' };
      }
    },
    ...overrides
  };
  return { deps, sent, created, updates };
}

test('normalizePayload reads Brillium keys case-insensitively', () => {
  const payload = normalizePayload({ aid: ' 12 ', Guid: 'g', EMAIL: 'A@B.com' });
  assert.equal(payload.assessmentId, '12');
  assert.equal(payload.guid, 'g');
  assert.equal(payload.email, 'a@b.com');
});

test('student found by email logs the attempt and emails the teacher', async () => {
  const { deps, sent, created, updates } = makeDeps();
  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'ok');
  assert.equal(result.matchedBy, 'email');
  assert.deepEqual(updates, [{ contactId: 'c1', fieldId: 'fw123', value: 'AL Forest Worker' }]);

  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    Student: 'Sam Green',
    Program: 'AL Forest Worker',
    Semester: 'Fall 2026',
    'Assessment Name': 'AL Forest Worker Quiz 3',
    'Assessment ID': '900',
    'Attempt #': 2,
    'Assessment Type': 'Quiz',
    'Pass/Fail': 'Pass',
    Score: '88',
    'Brillium GUID': 'guid-1',
    'Mailed or Emailed': false,
    'Teacher At Time': ['recT']
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'pat@school.edu');
  assert.equal(sent[0].cc, 'pat@home.com');
  assert.equal(sent[0].bcc, 'maggie@example.com');
  assert.equal(sent[0].subject, 'Student Quiz Results - Sam Green');
  assert.match(sent[0].text, /Hello Pat Jones,/);
  assert.match(sent[0].text, /Attempt #: 2/);
});

test('student found by name repairs the email then continues', async () => {
  const { deps, sent } = makeDeps();
  const repaired = [];
  deps.airtable.findStudentByEmail = async () => null;
  deps.airtable.findStudentByName = async () => ({ id: 'recS2', fields: { Teacher: ['recT'] } });
  deps.airtable.updateStudentEmail = async (id, email) => repaired.push({ id, email });

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.matchedBy, 'name');
  assert.deepEqual(repaired, [{ id: 'recS2', email: 'student@example.com' }]);
  assert.equal(sent[0].to, 'pat@school.edu');
});

test('no student record logs the attempt with TimesTaken and emails Maggie', async () => {
  const { deps, sent, created } = makeDeps();
  deps.airtable.findStudentByEmail = async () => null;
  deps.airtable.findStudentByName = async () => null;

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'unlinked');
  assert.equal(created[0]['Attempt #'], 3);
  assert.equal(created[0]['Teacher At Time'], undefined);
  assert.equal(sent[0].to, 'maggie@example.com');
  assert.match(sent[0].subject, /Unlinked Brillium Quiz/);
  assert.match(sent[0].text, /https:\/\/airtable.com\/app\/tbl\/recA/);
});

test('missing contact creates one and warns Maggie about the orphaned quiz', async () => {
  const { deps, sent } = makeDeps();
  deps.ghl.findContactByEmail = async () => null;

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.contactCreated, true);
  assert.match(sent[0].subject, /Orphaned Brillium Quiz/);
  assert.equal(sent[0].to, 'maggie@example.com');
});

test('teacher submissions stop after the program update', async () => {
  const { deps, sent, created } = makeDeps();
  deps.ghl.findContactByEmail = async () => ({
    id: 'c2',
    contactName: 'Pat Jones',
    tags: ['teacher']
  });

  const result = await createWorkflow(deps).run(webhookBody);

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'teacher_tag');
  assert.equal(created.length, 0);
  assert.equal(sent.length, 0);
});

test('a contact without the student tag is skipped', async () => {
  const { deps, created } = makeDeps();
  deps.ghl.findContactByEmail = async () => ({ id: 'c3', contactName: 'No Tags', tags: [] });

  const result = await createWorkflow(deps).run(webhookBody);
  assert.equal(result.reason, 'no_student_tag');
  assert.equal(created.length, 0);
});

test('a payload without AID or GUID is rejected', async () => {
  const { deps } = makeDeps();
  await assert.rejects(() => createWorkflow(deps).run({ EMAIL: 'a@b.com' }), /missing AID or GUID/);
});
