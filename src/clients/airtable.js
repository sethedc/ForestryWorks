import { config } from '../config.js';
import { requestJson } from '../http.js';

const API = 'https://api.airtable.com/v0';

const headers = () => ({ Authorization: `Bearer ${config.airtable.token}` });

const tableUrl = (table) =>
  `${API}/${config.airtable.baseId}/${encodeURIComponent(table)}`;

/** Airtable formula strings escape backslashes and double quotes. */
export function escapeFormulaValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function findOneByField(table, field, value) {
  if (!value) return null;
  const formula = `LOWER(TRIM({${field}})) = LOWER("${escapeFormulaValue(value)}")`;
  const url = `${tableUrl(table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  const response = await requestJson(url, {
    headers: headers(),
    label: `Airtable find record in ${table}`
  });
  return response?.records?.[0] ?? null;
}

/** Workflow step 8: Find Student by Email. */
export const findStudentByEmail = (email) =>
  findOneByField(config.airtable.studentsTable, config.airtable.studentEmailField, email);

/** Workflow step 14: Find Record by Student Name. */
export const findStudentByName = (name) =>
  findOneByField(config.airtable.studentsTable, config.airtable.studentNameField, name);

/** Workflow step 15: Update Record (write the email back onto the student). */
export async function updateStudentEmail(recordId, email) {
  return requestJson(`${tableUrl(config.airtable.studentsTable)}/${recordId}`, {
    method: 'PATCH',
    headers: headers(),
    label: 'Airtable update student email',
    body: {
      fields: { [config.airtable.studentEmailField]: email },
      typecast: config.airtable.typecast
    }
  });
}

/** Workflow steps 10/17: Fetch Teacher Emails. */
export async function getTeacher(recordId) {
  if (!recordId) return null;
  return requestJson(`${tableUrl(config.airtable.teachersTable)}/${recordId}`, {
    headers: headers(),
    label: 'Airtable get teacher'
  });
}

/** Workflow steps 11/18/21: Create Attempt Record. */
export async function createAttempt(fields) {
  const response = await requestJson(tableUrl(config.airtable.attemptsTable), {
    method: 'POST',
    headers: headers(),
    label: 'Airtable create attempt',
    body: { fields, typecast: config.airtable.typecast }
  });
  return response;
}

export function attemptRecordUrl(recordId) {
  return `https://airtable.com/${config.airtable.baseId}/${config.airtable.attemptsTable}/${recordId}`;
}

/** The linked Teacher column comes back as an array of record IDs. */
export function firstLinkedId(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return String(value);
}

export const airtable = {
  findStudentByEmail,
  findStudentByName,
  updateStudentEmail,
  getTeacher,
  createAttempt,
  attemptRecordUrl,
  firstLinkedId
};
