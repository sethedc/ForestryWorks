#!/usr/bin/env node
/**
 * Checks the two things that break on a new deploy: the Brillium API settings
 * and the Airtable token. Reads only, writes nothing.
 *
 *   npm run preflight -- --aid A0HVYA4P6JF7 --guid A9663FEB... [--email s@school.edu]
 */
import { config, validateConfig } from '../src/config.js';
import { requestJson } from '../src/http.js';
import { brillium } from '../src/clients/brillium.js';
import { airtable } from '../src/clients/airtable.js';
import { determineAssessmentType, determineProgram } from '../src/programs.js';
import { STUDENT_FIELDS, TEACHER_FIELDS } from '../src/airtable-schema.js';
import { attemptDate, semesterFor } from '../src/dates.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const results = [];
const ok = (name, detail) => results.push({ state: 'PASS', name, detail });
const fail = (name, detail) => results.push({ state: 'FAIL', name, detail });
const skip = (name, detail) => results.push({ state: 'SKIP', name, detail });

async function check(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (error) {
    fail(name, error.message);
  }
}

async function main() {
  try {
    validateConfig();
    ok('Configuration', 'required variables present');
  } catch (error) {
    fail('Configuration', error.message);
    report();
    return;
  }

  const aid = args.get('aid');
  const guid = args.get('guid');

  if (aid) {
    await check('Brillium assessment lookup', async () => {
      const assessment = await brillium.getAssessment(aid);
      if (!assessment) throw new Error('the API responded but returned no assessment');
      const name = assessment.Name || assessment.name || '';
      const program = determineProgram(name);
      return `"${name}" -> Program ${program ?? 'NONE'}, type ${determineAssessmentType(name)}, passing score ${assessment.PassingScore ?? 'n/a'}`;
    });
  } else {
    skip('Brillium assessment lookup', 'pass --aid to run it');
  }

  if (guid) {
    await check('Brillium respondent lookup', async () => {
      const respondent = await brillium.getRespondent(guid);
      if (!respondent) throw new Error('the API responded but returned no respondent');
      return `attempt ${respondent.Attempt ?? '?'} of ${respondent.TimesTaken ?? '?'}, score ${respondent.FinalScore ?? '?'}, ${respondent.Email ?? 'no email'}`;
    });
  } else {
    skip('Brillium respondent lookup', 'pass --guid to run it');
  }

  const tables = [
    ['Students', config.airtable.studentsTable],
    ['Teachers', config.airtable.teachersTable],
    ['Student Records', config.airtable.studentRecordsTable]
  ];
  for (const [label, table] of tables) {
    await check(`Airtable read: ${label}`, async () => {
      const url = `https://api.airtable.com/v0/${config.airtable.baseId}/${table}?maxRecords=1`;
      const response = await requestJson(url, {
        headers: { Authorization: `Bearer ${config.airtable.token}` },
        label: `Airtable read ${label}`
      });
      return `${table}, ${response?.records?.length ?? 0} record read`;
    });
  }

  const email = args.get('email');
  const name = args.get('name');
  if (email || name) {
    await check('Student lookup', async () => {
      const student =
        (email ? await airtable.findStudentByEmail(email) : null) ||
        (name ? await airtable.findStudentByName(name) : null);
      if (!student) throw new Error('no student matched, this attempt would need review');
      const teacherId = airtable.firstLinkedId(student.fields?.[STUDENT_FIELDS.teacher]);
      const teacher = teacherId ? await airtable.getTeacher(teacherId) : null;
      const teacherLabel = teacher
        ? `${teacher.fields?.[TEACHER_FIELDS.name]} <${teacher.fields?.[TEACHER_FIELDS.schoolEmail] ?? 'no school email'}>`
        : 'NO LINKED TEACHER';
      return `${student.fields?.[STUDENT_FIELDS.name]} (${student.id}) -> ${teacherLabel}`;
    });
  }

  const date = attemptDate();
  ok('Date and semester', `${date} -> "${semesterFor(date)}" in ${config.timezone}`);
  ok(
    'Write mode',
    `${config.dryRun ? 'DRY_RUN, nothing is written' : 'live writes'}; unmatched students: ${config.unmatchedStudentMode}; notify: ${config.notify.url || 'not configured'}`
  );

  report();
}

function report() {
  let failures = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.state === 'FAIL') failures += 1;
    if (result.state === 'SKIP') skipped += 1;
    process.stdout.write(`${result.state}  ${result.name}: ${result.detail}\n`);
  }
  const passed = results.length - failures - skipped;
  process.stdout.write(`\n${passed} passed, ${failures} failed, ${skipped} skipped\n`);
  process.exitCode = failures ? 1 : 0;
}

main();
