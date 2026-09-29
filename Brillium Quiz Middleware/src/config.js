import { TABLES } from './airtable-schema.js';

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const required = [];

const need = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') required.push(key);
  return value;
};

export const config = {
  port: Number(process.env.PORT || 8080),
  logLevel: process.env.LOG_LEVEL || 'info',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  timezone: process.env.TIMEZONE || 'America/Chicago',
  // Leave blank to derive "Spring YYYY" / "Fall YYYY" from the attempt date.
  currentSemester: process.env.CURRENT_SEMESTER || '',
  // park: log the attempt with no student link. create: add the student to Airtable.
  unmatchedStudentMode: (process.env.UNMATCHED_STUDENT_MODE || 'park').toLowerCase(),
  skipDuplicates: bool(process.env.SKIP_DUPLICATES, true),
  // Reads run as normal, writes and the outbound webhook are logged instead.
  dryRun: bool(process.env.DRY_RUN, false),

  brillium: {
    baseUrl: need('BRILLIUM_API_BASE'),
    // {aid} and {guid} are replaced with the webhook values.
    assessmentsPath: process.env.BRILLIUM_ASSESSMENTS_PATH || '/Assessments?AssessmentId={aid}',
    respondentsPath: process.env.BRILLIUM_RESPONDENTS_PATH || '/Respondents?RespondentGuid={guid}',
    authHeader: process.env.BRILLIUM_AUTH_HEADER || '',
    apiKey: process.env.BRILLIUM_API_KEY || '',
    apiKeyHeader: process.env.BRILLIUM_API_KEY_HEADER || 'X-API-KEY',
    username: process.env.BRILLIUM_USERNAME || '',
    password: process.env.BRILLIUM_PASSWORD || '',
    // Custom fields Brillium carries on the payload.
    teacherNameField: process.env.BRILLIUM_TEACHER_NAME_FIELD || 'CUST3',
    schoolNameField: process.env.BRILLIUM_SCHOOL_NAME_FIELD || 'CUST2',
    gradeLevelField: process.env.BRILLIUM_GRADE_LEVEL_FIELD || 'CUST4'
  },

  airtable: {
    token: need('AIRTABLE_TOKEN'),
    baseId: process.env.AIRTABLE_BASE_ID || 'appwFNJwQTtBif0yT',
    studentsTable: process.env.AIRTABLE_STUDENTS_TABLE || TABLES.students,
    teachersTable: process.env.AIRTABLE_TEACHERS_TABLE || TABLES.teachers,
    studentRecordsTable: process.env.AIRTABLE_STUDENT_RECORDS_TABLE || TABLES.studentRecords,
    // Select values are validated before they are sent, so typecast only has to
    // cover the Semester option rolling over to a new term.
    typecast: bool(process.env.AIRTABLE_TYPECAST, true)
  },

  notify: {
    url: process.env.NOTIFY_WEBHOOK_URL || '',
    // Optional bearer token and HMAC-SHA256 signature for the receiving system.
    token: process.env.NOTIFY_WEBHOOK_TOKEN || '',
    secret: process.env.NOTIFY_WEBHOOK_SECRET || '',
    signatureHeader: process.env.NOTIFY_SIGNATURE_HEADER || 'x-forestryworks-signature',
    // always: send every result. matched: only when student and teacher resolved.
    on: (process.env.NOTIFY_ON || 'always').toLowerCase()
  }
};

export function validateConfig() {
  const missing = [...required];
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!['park', 'create'].includes(config.unmatchedStudentMode)) {
    throw new Error('UNMATCHED_STUDENT_MODE must be "park" or "create"');
  }
}
