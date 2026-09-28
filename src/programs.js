/**
 * Workflow step "Determine Program": maps a Brillium quiz name to an FW Program
 * value using the same "contains" checks the GHL if/else node used.
 * Order matters; the first rule that matches wins.
 */
export const PROGRAM_RULES = [
  { program: 'AL Sawmill Worker', matches: ['al sawmill worker'] },
  { program: 'AL Logging Worker', matches: ['al logging worker'] },
  { program: 'AL Forest Worker', matches: ['al forest worker', 'al fw'] },
  { program: 'GA Forest Worker', matches: ['ga forest worker', 'ga fw'] },
  { program: 'KY Forest Worker', matches: ['ky forest worker', 'ky fw'] },
  { program: 'NC Forest Worker', matches: ['nc forest worker', 'nc fw', 'an53'] },
  { program: 'TN Forest Worker', matches: ['tn forest worker', 'tn fw'] },
  { program: 'TX Forest Worker', matches: ['tx forest worker', 'tx fw'] }
];

export function determineProgram(quizName) {
  const name = String(quizName || '').toLowerCase();
  if (!name) return null;
  for (const rule of PROGRAM_RULES) {
    if (rule.matches.some((needle) => name.includes(needle))) return rule.program;
  }
  return null;
}
