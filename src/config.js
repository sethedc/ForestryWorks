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
  currentSemester: process.env.CURRENT_SEMESTER || '',

  brillium: {
    baseUrl: need('BRILLIUM_API_BASE'),
    // Path templates. {aid} and {guid} are replaced with the webhook values.
    assessmentsPath: process.env.BRILLIUM_ASSESSMENTS_PATH || '/Assessments?AssessmentId={aid}',
    respondentsPath: process.env.BRILLIUM_RESPONDENTS_PATH || '/Respondents?RespondentGuid={guid}',
    // Auth: either a raw Authorization header, an API key header, or basic auth.
    authHeader: process.env.BRILLIUM_AUTH_HEADER || '',
    apiKey: process.env.BRILLIUM_API_KEY || '',
    apiKeyHeader: process.env.BRILLIUM_API_KEY_HEADER || 'X-API-KEY',
    username: process.env.BRILLIUM_USERNAME || '',
    password: process.env.BRILLIUM_PASSWORD || ''
  },

  ghl: {
    baseUrl: process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com',
    apiVersion: process.env.GHL_API_VERSION || '2021-07-28',
    token: need('GHL_API_TOKEN'),
    locationId: need('GHL_LOCATION_ID'),
    // Optional explicit custom field IDs. When blank the IDs are resolved by name/key.
    fwProgramFieldId: process.env.GHL_FW_PROGRAM_FIELD_ID || '',
    fwProgramFieldName: process.env.GHL_FW_PROGRAM_FIELD_NAME || 'FW Program',
    gradeLevelFieldId: process.env.GHL_GRADE_LEVEL_FIELD_ID || '',
    gradeLevelFieldName: process.env.GHL_GRADE_LEVEL_FIELD_NAME || 'Grade Level',
    teacherTag: (process.env.GHL_TEACHER_TAG || 'teacher').toLowerCase(),
    studentTag: (process.env.GHL_STUDENT_TAG || 'student').toLowerCase()
  },

  airtable: {
    token: need('AIRTABLE_TOKEN'),
    baseId: process.env.AIRTABLE_BASE_ID || 'appwFNJwQTtBif0yT',
    studentsTable: process.env.AIRTABLE_STUDENTS_TABLE || 'tblO81d82Ulhxz9np',
    attemptsTable: process.env.AIRTABLE_ATTEMPTS_TABLE || 'tblNpWWDu0YSgiark',
    teachersTable: process.env.AIRTABLE_TEACHERS_TABLE || 'Teachers',
    studentEmailField: process.env.AIRTABLE_STUDENT_EMAIL_FIELD || 'Email',
    studentNameField: process.env.AIRTABLE_STUDENT_NAME_FIELD || 'Student Name',
    studentTeacherField: process.env.AIRTABLE_STUDENT_TEACHER_FIELD || 'Teacher',
    // Set to true when the Attempts "Student" column is a linked-record field.
    studentAsLink: bool(process.env.AIRTABLE_ATTEMPT_STUDENT_AS_LINK, false),
    typecast: bool(process.env.AIRTABLE_TYPECAST, true)
  },

  mail: {
    transport: (process.env.EMAIL_TRANSPORT || 'smtp').toLowerCase(),
    from: process.env.MAIL_FROM || 'no-reply@forestryworks.com',
    replyTo: process.env.MAIL_REPLY_TO || '',
    maggieEmail: process.env.MAGGIE_EMAIL || 'mpope@forestryworks.com',
    teacherBcc: process.env.TEACHER_EMAIL_BCC || 'mpope@forestryworks.com',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  }
};

export function validateConfig() {
  const missing = [...required];
  if (config.mail.transport === 'smtp' && !config.mail.smtp.host) missing.push('SMTP_HOST');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
