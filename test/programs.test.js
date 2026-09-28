import test from 'node:test';
import assert from 'node:assert/strict';
import { determineProgram } from '../src/programs.js';

test('maps quiz names to FW programs', () => {
  assert.equal(determineProgram('AL Forest Worker Quiz 3'), 'AL Forest Worker');
  assert.equal(determineProgram('AL FW Safety Quiz'), 'AL Forest Worker');
  assert.equal(determineProgram('AL Sawmill Worker Quiz 1'), 'AL Sawmill Worker');
  assert.equal(determineProgram('AL Logging Worker Quiz 1'), 'AL Logging Worker');
  assert.equal(determineProgram('GA Forest Worker Quiz 2'), 'GA Forest Worker');
  assert.equal(determineProgram('ky fw quiz 4'), 'KY Forest Worker');
  assert.equal(determineProgram('AN53 Chainsaw Quiz'), 'NC Forest Worker');
  assert.equal(determineProgram('TN FW Quiz 1'), 'TN Forest Worker');
  assert.equal(determineProgram('TX Forest Worker Quiz 1'), 'TX Forest Worker');
});

test('sawmill and logging win over the AL Forest Worker rule', () => {
  assert.equal(determineProgram('AL Sawmill Worker - AL FW Series'), 'AL Sawmill Worker');
});

test('returns null when nothing matches', () => {
  assert.equal(determineProgram('General Safety Quiz'), null);
  assert.equal(determineProgram(''), null);
  assert.equal(determineProgram(undefined), null);
});
