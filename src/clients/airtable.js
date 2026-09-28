import { config } from '../config.js';
import { requestJson } from '../http.js';
import { RECORD_FIELDS, STUDENT_FIELDS } from '../airtable-schema.js';

const API = 'https://api.airtable.com/v0';

const headers = () => ({ Authorization: `Bearer ${config.airtable.token}` });

const tableUrl = (table) => `${API}/${config.airtable.baseId}/${encodeURIComponent(table)}`;

/** Airtable formula strings escape backslashes and double quotes. */
export function escapeFormulaValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function selectRecords(table, formula, maxRecords = 1) {
  const url = `${tableUrl(table)}?maxRecords=${maxRecords}&filterByFormula=${encodeURIComponent(
    formula
  )}`;
  const response = await requestJson(url, {
    headers: headers(),
    label: `Airtable select from ${table}`
  });
  return response?.records ?? [];
}

const matchField = (field, value) =>
  `LOWER(TRIM({${field}})) = LOWER("${escapeFormulaValue(String(value).trim())}")`;

export async function findStudentByEmail(email) {
  if (!email) return null;
  const [record] = await selectRecords(
    config.airtable.studentsTable,
    matchField(STUDENT_FIELDS.email, email)
  );
  return record ?? null;
}

export async function findStudentByName(name) {
  if (!name) return null;
  const [record] = await selectRecords(
    config.airtable.studentsTable,
    matchField(STUDENT_FIELDS.name, name)
  );
  return record ?? null;
}

export async function findTeacherByName(name) {
  if (!name) return null;
  const [record] = await selectRecords(
    config.airtable.teachersTable,
    matchField('Teacher Name', name)
  );
  return record ?? null;
}

export async function getTeacher(recordId) {
  if (!recordId) return null;
  return requestJson(`${tableUrl(config.airtable.teachersTable)}/${recordId}`, {
    headers: headers(),
    label: 'Airtable get teacher'
  });
}

export async function createStudent(fields) {
  const response = await requestJson(tableUrl(config.airtable.studentsTable), {
    method: 'POST',
    headers: headers(),
    label: 'Airtable create student',
    body: { fields, typecast: config.airtable.typecast }
  });
  return response;
}

export async function updateStudent(recordId, fields) {
  return requestJson(`${tableUrl(config.airtable.studentsTable)}/${recordId}`, {
    method: 'PATCH',
    headers: headers(),
    label: 'Airtable update student',
    body: { fields }
  });
}

/** Guards against duplicate rows when Brillium redelivers the same result. */
export async function findExistingAttempt(guid, attemptNumber) {
  if (!guid) return null;
  const parts = [matchField(RECORD_FIELDS.brilliumGuid, guid)];
  if (attemptNumber !== '' && attemptNumber !== null && attemptNumber !== undefined) {
    parts.push(matchField(RECORD_FIELDS.attemptNumber, attemptNumber));
  }
  const [record] = await selectRecords(
    config.airtable.studentRecordsTable,
    `AND(${parts.join(', ')})`
  );
  return record ?? null;
}

export async function createStudentRecord(fields) {
  return requestJson(tableUrl(config.airtable.studentRecordsTable), {
    method: 'POST',
    headers: headers(),
    label: 'Airtable create student record',
    body: { fields, typecast: config.airtable.typecast }
  });
}

export function recordUrl(table, recordId) {
  return `https://airtable.com/${config.airtable.baseId}/${table}/${recordId}`;
}

export function studentRecordUrl(recordId) {
  return recordUrl(config.airtable.studentRecordsTable, recordId);
}

/** Linked-record fields come back as arrays of record IDs. */
export function firstLinkedId(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    if (!first) return null;
    return typeof first === 'string' ? first : first.id ?? null;
  }
  return String(value);
}

export const airtable = {
  findStudentByEmail,
  findStudentByName,
  findTeacherByName,
  getTeacher,
  createStudent,
  updateStudent,
  findExistingAttempt,
  createStudentRecord,
  studentRecordUrl,
  firstLinkedId
};
