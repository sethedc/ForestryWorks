import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM_CHOICES, determineAssessmentType, determineProgram } from '../src/programs.js';

test('maps assessment names to the Program select options', () => {
  assert.equal(determineProgram('AL Forest Worker Quiz 3'), 'AL Forest Worker');
  assert.equal(determineProgram('AL FW Safety Quiz'), 'AL Forest Worker');
  assert.equal(determineProgram('AL Sawmill Worker Quiz 1'), 'AL Sawmill Worker');
  assert.equal(determineProgram('AL Logging Worker Quiz 1'), 'AL Logging Worker');
  assert.equal(determineProgram('GA Forest Worker Quiz 2'), 'GA Forest Worker');
  assert.equal(determineProgram('ky fw quiz 4'), 'KY Forest Worker');
  assert.equal(determineProgram('AN53 Chainsaw Quiz'), 'NC Forest Worker');
  assert.equal(determineProgram('TN FW Module 1 Quiz'), 'TN Forest Worker');
  assert.equal(determineProgram('TX Forest Worker Quiz 1'), 'TX Forest Worker');
});

test('every rule produces a value that exists on the Program field', () => {
  const live = [
    'AL Forest Worker',
    'AL Logging Worker',
    'AL Sawmill Worker',
    'GA Forest Worker',
    'KY Forest Worker',
    'NC Forest Worker',
    'TN Forest Worker',
    'TX Forest Worker'
  ];
  for (const choice of PROGRAM_CHOICES) assert.ok(live.includes(choice), `${choice} is not an option`);
});

test('sawmill and logging win over the AL Forest Worker rule', () => {
  assert.equal(determineProgram('AL Sawmill Worker - AL FW Series'), 'AL Sawmill Worker');
});

test('returns null when nothing matches', () => {
  assert.equal(determineProgram('General Safety Quiz'), null);
  assert.equal(determineProgram(''), null);
});

test('assessment type follows the name', () => {
  assert.equal(determineAssessmentType('TN FW Module 1 Quiz'), 'Quiz');
  assert.equal(determineAssessmentType('TN FW Final Exam'), 'Exam');
});
