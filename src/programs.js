/**
 * Maps a Brillium assessment name to the Program single-select on Student Records.
 * Matching is case-insensitive "contains"; the first rule that matches wins, so
 * Sawmill and Logging sit above the AL Forest Worker rule.
 */
export const PROGRAM_RULES = [
  { program: 'AL Sawmill Worker', matches: ['al sawmill worker', 'al sw'] },
  { program: 'AL Logging Worker', matches: ['al logging worker', 'al lw'] },
  { program: 'AL Forest Worker', matches: ['al forest worker', 'al fw'] },
  { program: 'GA Forest Worker', matches: ['ga forest worker', 'ga fw'] },
  { program: 'KY Forest Worker', matches: ['ky forest worker', 'ky fw'] },
  { program: 'NC Forest Worker', matches: ['nc forest worker', 'nc fw', 'an53'] },
  { program: 'TN Forest Worker', matches: ['tn forest worker', 'tn fw'] },
  { program: 'TX Forest Worker', matches: ['tx forest worker', 'tx fw'] }
];

/** The eight options that exist on the Program field today. */
export const PROGRAM_CHOICES = PROGRAM_RULES.map((rule) => rule.program);

export function determineProgram(assessmentName) {
  const name = String(assessmentName || '').toLowerCase();
  if (!name) return null;
  for (const rule of PROGRAM_RULES) {
    if (rule.matches.some((needle) => name.includes(needle))) return rule.program;
  }
  return null;
}

/** Brillium names an exam "... Exam"; everything else is treated as a quiz. */
export function determineAssessmentType(assessmentName) {
  return /\bexam\b/i.test(String(assessmentName || '')) ? 'Exam' : 'Quiz';
}
