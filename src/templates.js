const line = (label, value) => `${label}: ${value || 'N/A'}`;

/** Workflow step 13/20: Send Teacher Student Results. */
export function teacherResultsEmail({ teacherName, studentName, quizName, score, passFail, attempt }) {
  const greeting = teacherName ? `Hello ${teacherName},` : 'Hello,';
  const text = [
    greeting,
    '',
    'Here are the latest quiz results for one of your students.',
    '',
    line('Student', studentName),
    line('Quiz', quizName),
    line('Score', score),
    line('Pass/Fail', passFail),
    line('Attempt #', attempt),
    '',
    'Thank you,',
    'ForestryWorks'
  ].join('\n');

  return {
    subject: `Student Quiz Results - ${studentName}`,
    text
  };
}

/** Workflow step 7: Email to Maggie, "Orphaned Brillium Quiz". */
export function orphanedQuizEmail({ studentName, email, quizName, assessmentId, score, passFail, attempt, guid, gradeLevel }) {
  const text = [
    'A Brillium quiz came in for a student who did not exist in the CRM.',
    'A contact was created, but the student still needs to be added or linked in Airtable.',
    '',
    line('Student', studentName),
    line('Email', email),
    line('Grade Level', gradeLevel),
    line('Exam', quizName),
    line('Exam ID', assessmentId),
    line('Score', score),
    line('Pass/Fail', passFail),
    line('Attempt #', attempt),
    line('Respondent ID', guid)
  ].join('\n');

  return { subject: `Orphaned Brillium Quiz - ${studentName}`, text };
}

/** Workflow step 22: Email to Maggie, "Unlinked Brillium Quiz". */
export function unlinkedQuizEmail({ studentName, email, quizName, assessmentId, score, passFail, attempt, guid, recordUrl }) {
  const text = [
    'A Brillium quiz was logged but the student could not be matched in Airtable.',
    'Open the attempt record below and link the correct student and teacher.',
    '',
    line('Student', studentName),
    line('Email', email),
    line('Exam', quizName),
    line('Exam ID', assessmentId),
    line('Score', score),
    line('Pass/Fail', passFail),
    line('Attempt #', attempt),
    line('Respondent ID', guid),
    '',
    line('Attempt record', recordUrl)
  ].join('\n');

  return { subject: `Unlinked Brillium Quiz - ${studentName}`, text };
}
