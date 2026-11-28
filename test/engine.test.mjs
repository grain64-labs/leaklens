// End-to-end tests: run the CLI the way a user does. No test calls a model: --judge runs against test/stub-server.mjs,
// which serves the answers the hosted Leaklens tables recorded for the 10 fixture tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-server.mjs';
import { fixCommit, findClone } from '../src/gitdate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(ROOT, 'fixtures/swe-bench-verified-10.jsonl');
const ENV = { PATH: process.env.PATH, HOME: os.tmpdir() }; // no API keys reach the CLI
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leaklens-test-'));
const read = (p) => fs.readFileSync(p, 'utf8');
const rows = (dir) => read(path.join(dir, 'results.jsonl')).trim().split('\n').map((l) => JSON.parse(l));

function run(args, env = ENV) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'bin/leaklens.mjs'), ...args], { cwd: ROOT, env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// fixtures/stored-verdicts.csv: the stored live verdicts (no field in it contains a comma)
const stored = Object.fromEntries(read(path.join(ROOT, 'fixtures/stored-verdicts.csv')).trim().split('\n').slice(1).map((l) => {
  const [instance_id, tier, state, agreement, patch_overlap_flag, fix_pr_linked_in, fix_commit_date, fix_commit_sha] = l.split(',');
  return [instance_id, { tier, state, agreement, overlap: patch_overlap_flag === '1', link: fix_pr_linked_in || null, date: fix_commit_date, sha: fix_commit_sha || null }];
}));

test('deterministic check: output is byte-for-byte fixtures/expected', async () => {
  const out = tmp();
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['results.jsonl', 'summary.md']) assert.equal(read(path.join(out, f)), read(path.join(ROOT, 'fixtures/expected', f)), f);
  // the bold line names what was measured, and the published count for the same tasks follows it
  assert.match(r.stdout, /\*\*5 of 10 tasks \(50%\): gold-patch lines in the issue or discussion \(Tier C\)\. Tier A\/B not read\.\*\*/);
  assert.doesNotMatch(r.stdout, /tasks flagged/);
  assert.match(r.stdout, /Leaklens public table for these 10 tasks: 6 flagged \(Tier A where both checks agreed, or Tier C\), methodology m1\.1, as of 2026-11-08: https:\/\/leaklens\.grain64\.com\/benchmarks\/swe-bench-verified/);
  assert.ok(rows(out).every((x) => x.procedure === 'rules'));
});

test('deterministic check: Tier C and fix-PR links equal the stored live verdicts on all 10 tasks', async () => {
  const out = tmp();
  await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--out', out, '--quiet']);
  const got = rows(out);
  assert.equal(got.length, 10);
  for (const r of got) {
    const s = stored[r.instance_id];
    assert.ok(s, r.instance_id);
    assert.equal(r.tier_c.flag, s.overlap, `${r.instance_id} tier C`);
    assert.equal(r.fix_pr_link ? r.fix_pr_link.source : null, s.link, `${r.instance_id} link`);
    assert.equal(r.judge, null);
    assert.equal(r.fix_commit, null);
  }
});

test('--judge (recorded answers, local stub): byte-for-byte fixtures/expected-judged and the live tier/state/agreement', async () => {
  const stub = await startStub();
  const out = tmp();
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--tiebreak', '--model', 'recorded', '--base-url', stub.url, '--out', out]);
  await stub.close();
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['results.jsonl', 'summary.md']) assert.equal(read(path.join(out, f)), read(path.join(ROOT, 'fixtures/expected-judged', f)), f);
  for (const row of rows(out)) {
    const s = stored[row.instance_id];
    assert.deepEqual([row.tier, row.state, row.agreement], [s.tier, s.state, s.agreement], row.instance_id);
    for (const run of row.judge.runs) for (const q of run.quotes) {
      const task = JSON.parse(read(FIXTURE).split('\n').find((l) => l.includes(`"${row.instance_id}"`)));
      const hay = q.source === 'discussion' ? task.hints_text : task.problem_statement;
      assert.equal(hay.slice(q.start, q.end), q.text, `${row.instance_id}: quote is verbatim at its offsets`);
    }
  }
  // two checks per task, a third only on the one split that Tier C does not settle (as the hosted tables did)
  assert.equal(stub.requests.length, 21);
  assert.ok(stub.requests.every((q) => !q.headers.authorization), 'no key was sent to a local endpoint without one');
  assert.ok(stub.requests.every((q) => q.body.response_format.type === 'json_schema' && q.body.model === 'recorded'));
});

test('--judge alone runs the published m1.1 procedure; --no-tiebreak and --no-reasoning-effort are named on every row and in the summary', async () => {
  // default: the same bytes as --judge --tiebreak (fixtures/expected-judged), reasoning effort low then medium, a third check on the split
  const stub = await startStub();
  const out = tmp();
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', stub.url, '--out', out, '--quiet']);
  await stub.close();
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['results.jsonl', 'summary.md']) assert.equal(read(path.join(out, f)), read(path.join(ROOT, 'fixtures/expected-judged', f)), f);
  assert.equal(stub.requests.length, 21);
  assert.deepEqual([...new Set(stub.requests.map((q) => q.body.reasoning_effort))].sort(), ['low', 'medium']);
  assert.ok(rows(out).every((x) => x.procedure === 'm1.1'));
  const md = read(path.join(out, 'summary.md'));
  assert.match(md, /with the published m1\.1 procedure: two checks \(reasoning effort low, then medium\) and a third on splits/);
  assert.match(md, /\*\*7 of 10 tasks flagged \(70%\): Tier A or B read by `recorded`, or Tier C by rule\.\*\*/);
  assert.match(md, /Leaklens public table for these 10 tasks: 6 flagged/);

  // --no-tiebreak: two calls a task, labelled, and a rerun with the default procedure does not reuse those rows
  const s2 = await startStub();
  const out2 = tmp();
  const r2 = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--no-tiebreak', '--model', 'recorded', '--base-url', s2.url, '--out', out2, '--quiet']);
  await s2.close();
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(s2.requests.length, 20);
  assert.ok(rows(out2).every((x) => x.procedure === 'm1.1-no-tiebreak'));
  assert.match(read(path.join(out2, 'summary.md')), /no third check on splits \(--no-tiebreak\): not the published m1\.1 procedure/);
  const s3 = await startStub();
  const r3 = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', s3.url, '--out', out2]);
  await s3.close();
  assert.equal(r3.code, 0, r3.stderr);
  assert.doesNotMatch(r3.stderr, /reusing/);
  assert.equal(s3.requests.length, 21, 'rows from another procedure are judged again');

  // --no-reasoning-effort: no reasoning_effort is sent
  const s4 = await startStub();
  const out4 = tmp();
  const r4 = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--no-reasoning-effort', '--model', 'recorded', '--base-url', s4.url, '--out', out4, '--quiet']);
  await s4.close();
  assert.equal(r4.code, 0, r4.stderr);
  assert.ok(s4.requests.every((q) => !('reasoning_effort' in q.body)));
  assert.ok(rows(out4).every((x) => x.procedure === 'm1.1-no-effort'));

  // contradictions and flags without --judge are input errors, before any call
  for (const [args, msg] of [
    [['--judge', '--tiebreak', '--no-tiebreak'], /--tiebreak and --no-tiebreak contradict each other/],
    [['--judge', '--reasoning-effort', '--no-reasoning-effort'], /--reasoning-effort and --no-reasoning-effort contradict each other/],
    [['--no-tiebreak'], /--no-tiebreak needs --judge/],
  ]) {
    const e = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', ...args, '--model', 'recorded', '--base-url', 'http://127.0.0.1:9/v1', '--out', tmp()]);
    assert.equal(e.code, 2, args.join(' '));
    assert.match(e.stderr, msg);
  }
});

test('the published line counts the tasks of the input that are in the table, and is left out when none are', async () => {
  const dir = tmp();
  const lines = read(FIXTURE).trim().split('\n');
  const some = path.join(dir, 'some.jsonl');
  const renamed = lines.slice(0, 2).map((l, i) => { const t = JSON.parse(l); t.instance_id = t.instance_id.replace(/-\d+$/, `-99999${i}`); return JSON.stringify(t); });
  fs.writeFileSync(some, [...lines.slice(0, 3), ...renamed].join('\n') + '\n');
  const r = await run(['check', some, '--out', path.join(dir, 'o1')]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Leaklens public table for the 3 of these tasks in SWE-bench Verified: \d+ flagged/);
  const none = path.join(dir, 'none.jsonl');
  fs.writeFileSync(none, renamed.join('\n') + '\n');
  const r2 = await run(['check', none, '--out', path.join(dir, 'o2')]);
  assert.equal(r2.code, 0, r2.stderr);
  assert.doesNotMatch(r2.stdout, /public table/);
});

test('--judge keeps finished tasks when the endpoint fails, and the next run resumes from them', async () => {
  const out = tmp();
  const bad = await startStub({ failAfter: 6 });
  const r1 = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', bad.url, '--out', out, '--concurrency', '1', '--quiet']);
  await bad.close();
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /HTTP 500/);
  assert.match(r1.stderr, /3 of 10 tasks finished and kept/);
  assert.equal(rows(out).length, 3);
  const good = await startStub();
  const r2 = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', good.url, '--out', out, '--concurrency', '1']);
  await good.close();
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stderr, /reusing 3 tasks/);
  // 7 unfinished tasks x 2 checks, plus the default third check on the one split among them
  assert.equal(good.requests.length, 15, 'only the 7 unfinished tasks were judged');
  assert.equal(rows(out).length, 10);
});

test('--judge falls back when the server rejects json_schema, and reads JSON wrapped in prose', async () => {
  const stub = await startStub({ rejectSchema: true, wrapInProse: true });
  const out = tmp();
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', stub.url, '--out', out, '--quiet']);
  await stub.close();
  assert.equal(r.code, 0, r.stderr);
  assert.ok(stub.requests.some((q) => q.body.response_format && q.body.response_format.type === 'json_object'));
  assert.equal(rows(out).find((x) => x.instance_id === 'astropy__astropy-14096').tier, 'B');
});

test('--judge on api.openai.com without a key stops before any call', async () => {
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'gpt-x', '--out', tmp()]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /needs a key in LEAKLENS_API_KEY or OPENAI_API_KEY/);
});

test('rejected rows are listed with line and reason and the valid rows are checked; --strict fails the whole file', async () => {
  const dir = tmp();
  const f = path.join(dir, 'bad.jsonl');
  const lines = read(FIXTURE).trim().split('\n');
  const empty = JSON.stringify({ ...JSON.parse(lines[1]), patch: '' });
  fs.writeFileSync(f, [lines[0], '{"instance_id":"x__y-1","patch":"p"}', 'not json', lines[0], empty, lines[2]].join('\n') + '\n');
  const out = path.join(dir, 'out');
  const r = await run(['check', f, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(rows(out).map((x) => x.instance_id), [JSON.parse(lines[0]).instance_id, JSON.parse(lines[2]).instance_id]);
  const md = read(path.join(out, 'summary.md'));
  assert.match(md, /Methodology m1\.1 · 2 tasks/);
  assert.match(md, /4 rows rejected and not checked, listed under "Rejected rows" below \(`--strict` fails the whole file instead\)\./);
  for (const s of [md, r.stdout]) {
    assert.match(s, /## Rejected rows\n\n- line 2 \(x__y-1\): missing problem_statement\n- line 3: not valid JSON\n- line 4 \(astropy__astropy-13236\): duplicate instance_id astropy__astropy-13236\n- line 5 \(astropy__astropy-14096\): empty patch\n/);
  }
  // --strict: the v2 behaviour, every rejected row named, nothing written
  const out2 = path.join(dir, 'out2');
  const s = await run(['check', f, '--strict', '--out', out2]);
  assert.equal(s.code, 2);
  assert.match(s.stderr, /4 task\(s\) rejected, nothing checked \(--strict\):\nline 2 \(x__y-1\): missing problem_statement\nline 3: not valid JSON\nline 4 .*duplicate instance_id astropy__astropy-13236\nline 5 \(astropy__astropy-14096\): empty patch/);
  assert.equal(fs.existsSync(out2), false);
  // a file with no valid row: nothing to check, exit 2, nothing written
  const g = path.join(dir, 'none.jsonl');
  fs.writeFileSync(g, ['not json', empty].join('\n') + '\n');
  const n = await run(['check', g, '--out', out2]);
  assert.equal(n.code, 2);
  assert.match(n.stderr, /2 task\(s\) rejected, nothing checked, no valid row left:\nline 1: not valid JSON\nline 2 \(astropy__astropy-14096\): empty patch/);
  assert.equal(fs.existsSync(out2), false);
  // a clean file gives no rejected section (the fixture bytes test above holds it byte for byte)
  assert.doesNotMatch(read(path.join(ROOT, 'fixtures/expected/summary.md')), /Rejected rows|construction diff|reversed/);
  const u = await run(['check', FIXTURE, '--bogus']);
  assert.equal(u.code, 2);
  assert.match(u.stderr, /unknown option --bogus/);
});

test('a construction diff is named with one line; --reverse-patch checks the removed side and drops test files', async () => {
  const dir = tmp();
  const body = ['def total(items):', '    total_price = None', '    acc = 0', '    for it in items:', '        if it.price is None:', '            continue', '        acc += it.price * it.qty', '    if acc < 0:', '        raise ValueError("negative")', '    if not items:', '        return 0.0', '    return round(acc, 2)'];
  // construction diff (FeatureBench style): the body is removed and a stub left; the test file is removed too, so reversing alone would add it
  const patch = ['diff --git a/shop/cart.py b/shop/cart.py', '--- a/shop/cart.py', '+++ b/shop/cart.py', '@@ -1,13 +1,3 @@',
    ' ' + body[0], ...body.slice(1).map((l) => '-' + l), '+    pass', '+', '',
    'diff --git a/tests/test_cart.py b/tests/test_cart.py', '--- a/tests/test_cart.py', '+++ b/tests/test_cart.py', '@@ -1,2 +0,0 @@', '-def test_total():', '-    assert total([]) == 0', ''].join('\n');
  const issue = 'Implement total() as follows:\n\n' + body.join('\n');
  const f = path.join(dir, 'fb.jsonl');
  fs.writeFileSync(f, JSON.stringify({ instance_id: 'acme__shop-7', problem_statement: issue, patch }) + '\n');
  const out = path.join(dir, 'out');
  const r = await run(['check', f, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  const warn = /Warning: this looks like a construction diff; pass `--reverse-patch`\. In 1 of 1 patches the added lines are mostly blank or stubs/;
  assert.match(r.stdout, warn);
  assert.equal(r.stdout.match(/construction diff/g).length, 1, 'one line, not one per task');
  assert.equal(rows(out)[0].tier_c.flag, false, 'the stub side matched nothing');
  assert.equal('patch_reversed' in rows(out)[0], false);
  const out2 = path.join(dir, 'out2');
  const r2 = await run(['check', f, '--reverse-patch', '--out', out2]);
  assert.equal(r2.code, 0, r2.stderr);
  assert.doesNotMatch(r2.stdout, /construction diff/);
  assert.match(r2.stdout, /Patches reversed \(`--reverse-patch`\): the removed lines were checked as the solution, test-file sections dropped\./);
  const row = rows(out2)[0];
  assert.equal(row.patch_reversed, true);
  assert.equal(row.tier_c.flag, true);
  assert.equal(row.tier_c.matched_line_count, row.tier_c.patch_line_count, 'every restored body line is in the issue');
  assert.ok(row.tier_c.matched_lines.includes('acc += it.price * it.qty'));
  assert.ok(row.tier_c.patch_line_count > 0 && !row.tier_c.matched_lines.some((l) => l.includes('test_total')), 'the test file section is dropped');
  // a patch that is test files only has nothing left after reversing: listed as rejected
  const g = path.join(dir, 'tests-only.jsonl');
  fs.writeFileSync(g, [JSON.stringify({ instance_id: 'acme__shop-8', problem_statement: 'x', patch: patch.slice(patch.indexOf('diff --git a/tests')) }), JSON.stringify({ instance_id: 'acme__shop-7', problem_statement: issue, patch })].join('\n') + '\n');
  const r3 = await run(['check', g, '--reverse-patch', '--out', path.join(dir, 'out3')]);
  assert.equal(r3.code, 0, r3.stderr);
  assert.match(r3.stdout, /- line 1 \(acme__shop-8\): patch has only test-file sections, nothing left after --reverse-patch/);
  // SWE-bench Verified's own patches never trigger the warning (fixture: 10 tasks)
  const r4 = await run(['check', FIXTURE, '--out', path.join(dir, 'out4')]);
  assert.doesNotMatch(r4.stdout, /construction diff/);
});

test('a JSON array input gives the same rows as JSONL', async () => {
  const dir = tmp();
  const f = path.join(dir, 'tasks.json');
  fs.writeFileSync(f, JSON.stringify(read(FIXTURE).trim().split('\n').map((l) => JSON.parse(l))));
  const out = path.join(dir, 'out');
  const r = await run(['check', f, '--out', out, '--quiet']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(path.join(out, 'results.jsonl')), read(path.join(ROOT, 'fixtures/expected/results.jsonl')));
});

test('a file saved with a UTF-8 byte-order mark reads the same; --out on a file is a clear input error', async () => {
  const dir = tmp();
  const f = path.join(dir, 'bom.jsonl');
  fs.writeFileSync(f, '﻿' + read(FIXTURE));
  const out = path.join(dir, 'out');
  const r = await run(['check', f, '--out', out, '--quiet']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(path.join(out, 'results.jsonl')), read(path.join(ROOT, 'fixtures/expected/results.jsonl')));
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  const e = await run(['check', FIXTURE, '--out', file]);
  assert.equal(e.code, 2);
  assert.match(e.stderr, /--out .*a-file: is a file, not a directory/);
  assert.equal(read(file), 'x');
});

test('--repos: finds the fix commit and its date in a local clone (synthetic repository)', async () => {
  const dir = tmp();
  const repo = path.join(dir, 'acme_widgets');
  fs.mkdirSync(repo);
  const git = (args, date) => execFileSync('git', ['-C', repo, ...args], { env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org' }, stdio: 'pipe' }).toString();
  git(['init', '-q', '-b', 'main'], '2024-01-01T00:00:00Z');
  fs.writeFileSync(path.join(repo, 'calc.py'), 'def add(a, b):\n    return a - b\n');
  git(['add', '.'], '2024-01-01T00:00:00Z');
  git(['commit', '-qm', 'start'], '2024-01-01T00:00:00Z');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'unrelated\n');
  git(['add', '.'], '2024-02-01T00:00:00Z');
  git(['commit', '-qm', 'Unrelated change (#41)'], '2024-02-01T00:00:00Z');
  fs.writeFileSync(path.join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  git(['add', '.'], '2024-03-05T10:20:30Z');
  git(['commit', '-qm', 'Fix add() sign (#42)'], '2024-03-05T10:20:30Z');
  const sha = git(['rev-parse', 'HEAD'], '2024-03-05T10:20:30Z').trim();
  const patch = 'diff --git a/calc.py b/calc.py\n--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n';
  const tasks = path.join(dir, 'tasks.jsonl');
  fs.writeFileSync(tasks, JSON.stringify({ instance_id: 'acme__widgets-42', problem_statement: 'add() subtracts instead of adding', patch, created_at: '2024-03-01T00:00:00Z' }) + '\n');
  assert.equal(findClone(dir, 'acme/widgets'), repo);
  const out = path.join(dir, 'out');
  const r = await run(['check', tasks, '--repos', dir, '--out', out, '--quiet']);
  assert.equal(r.code, 0, r.stderr);
  const fc = rows(out)[0].fix_commit;
  assert.deepEqual(fc, { located: true, sha, date: '2024-03-05T10:20:30.000Z', how: 'message', similarity: 1, url: `https://github.com/acme/widgets/commit/${sha}` });
  assert.match(read(path.join(out, 'summary.md')), /Fix commit located in the local clone \| 1 \|/);
  // no message match: found by the patched path after the task was opened
  git(['commit', '-q', '--amend', '-m', 'Fix add() sign'], '2024-03-05T10:20:30Z');
  const byPath = fixCommit(repo, { instance_id: 'acme__widgets-42', repo: 'acme/widgets', pr_number: 42, patch, created_at: '2024-03-01T00:00:00Z' });
  assert.equal(byPath.how, 'path');
  assert.equal(byPath.date, '2024-03-05T10:20:30.000Z');
  // a clone of another repository is not used
  const none = await run(['check', tasks, '--repos', path.join(dir, 'missing'), '--out', out]);
  assert.equal(none.code, 2);
});

test('DEFINITIONS.md is generated from src/definitions.mjs and up to date', () => {
  const r = execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-definitions.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(r, /up to date/);
});

test('BEN-620: --judge never reads a reply with no verdict as none: it retries once, then stops with an error', async () => {
  const stub = await startStub({ blankAnswers: true });
  const out = tmp();
  const r = await run(['check', 'fixtures/swe-bench-verified-10.jsonl', '--judge', '--model', 'recorded', '--base-url', stub.url, '--out', out, '--quiet', '--concurrency', '1']);
  await stub.close();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no verdict: the reply has no rationale \(twice\)/);
  assert.ok(!fs.existsSync(path.join(out, 'results.jsonl')), 'no results file with a made-up none');
  assert.ok(stub.requests.length >= 2 && stub.requests.length <= 4);
});

test('a rules-only run with 0 Tier C says what it did not read and gives the --judge command; a run with flags does not', async () => {
  const dir = tmp();
  const clean = path.join(dir, 'clean.jsonl');
  fs.writeFileSync(clean, JSON.stringify({ instance_id: 'acme__dates-8', problem_statement: 'parse_date fails on a trailing space.', patch: '--- a/dates.py\n+++ b/dates.py\n@@ -1,1 +1,2 @@\n def parse_date(value):\n+    value = value.strip()\n' }) + '\n');
  const r = await run(['check', clean, '--out', path.join(dir, 'o1')]);
  assert.equal(r.code, 0, r.stderr);
  const s = read(path.join(dir, 'o1/summary.md'));
  assert.match(s, /\*\*0 of 1 tasks \(0%\)/);
  assert.match(s, /0 here is not "clean"\. Without `--judge` this run finds the patch-line kind only; on SWE-bench Verified that was 18 of the 149 published flags\./);
  assert.ok(s.includes(`LEAKLENS_API_KEY="$YOUR_KEY" node bin/leaklens.mjs check ${clean} --out ${path.join(dir, 'o1')} --judge --model "$MODEL"`), s);
  const r2 = await run(['check', FIXTURE, '--out', path.join(dir, 'o2')]);
  assert.equal(r2.code, 0, r2.stderr);
  assert.doesNotMatch(read(path.join(dir, 'o2/summary.md')), /is not "clean"/);
});
