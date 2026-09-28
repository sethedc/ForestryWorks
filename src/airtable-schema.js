/**
 * Field and table names verified against base appwFNJwQTtBif0yT.
 * Field IDs are noted so a rename in Airtable is easy to trace back.
 */
export const TABLES = {
  students: 'tblO81d82Ulhxz9np',
  teachers: 'tbl5eFPrtLsStLKQe',
  studentRecords: 'tblNpWWDu0YSgiark'
};

export const STUDENT_FIELDS = {
  name: 'Student Name', // fldgZIVjHg1q4XnBh
  email: 'Email', // fldACy3rfk8H9nWb2
  teacher: 'Teacher', // fldM4cbAYZSq1I0lc  (linked records)
  gradeLevel: 'Grade Level' // fldrT0bOhCvb2p3ml (single select)
};

export const TEACHER_FIELDS = {
  name: 'Teacher Name', // fldBtLLQngzHPZZfP
  schoolEmail: 'School Email', // fldgL88NoyU5VCxCx
  alternateEmail: 'Alternate Email', // fldENBEHpcwF27A8G
  phone: 'Phone', // fldMu3ngyRxcMdBFt
  school: 'School', // fldXZDXJC8NRCVd7c  (linked records)
  state: 'State (from School)', // fld3epHUpezbl84AJ
  county: 'County (from School)' // fld5OTaFZOvAWXya9
};

export const RECORD_FIELDS = {
  student: 'Student', // fldjZ9UCjWpc7w1PC  (linked records)
  program: 'Program', // fldCBrvBDul9lJfom (single select)
  teacherAtTime: 'Teacher At Time', // fldeUTIBIrXR4ZBuy (linked records)
  gradeLevel: 'Grade Level', // fldkDg50WwEDyFeq5 (single select)
  attemptDate: 'Attempt Date', // fldOHaGnayQNlqmQN (date)
  semester: 'Semester', // fldiGtvowDKpuSqL7 (single select)
  assessmentName: 'Assessment Name', // fldlsArAIVhnGu2OB
  assessmentId: 'Assessment ID', // fld8sYKyjUM4LtJeN
  attemptNumber: 'Attempt #', // fld8gtAC7876KTKBY
  assessmentType: 'Assessment Type', // fldce8yLGVSE1MT40 (single select)
  passFail: 'Pass/Fail', // fldWAZSzUrWFg9IK2 (single select)
  score: 'Score', // fldtiZYrRJ4gnNj4P
  brilliumGuid: 'Brillium GUID', // fldnfErwBestlvrTS
  mailedOrEmailed: 'Mailed or Emailed' // fldlsY2wiKAnNosFf (checkbox)
};

/** Exact single-select options. Anything outside these lists is dropped, not invented. */
export const ASSESSMENT_TYPES = ['Quiz', 'Exam'];
export const PASS_FAIL = ['Pass', 'Fail'];
