// SWE-bench Pro V2 recount and quote check (src/pro-v2.mjs, leaklens pro-v2). No network, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recount, verify, goldRef } from '../src/pro-v2.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../data/swe-bench-pro-v2.json', import.meta.url), 'utf8'));
const bin = new URL('../bin/leaklens.mjs', import.meta.url).pathname;

test('the shipped file holds 642 tasks and its stored figure recounts', () => {
  const r = recount(data);
  assert.equal(r.total, 642);
  assert.equal(new Set(data.tasks.map((t) => t.id)).size, 642);
  assert.ok(r.agrees, `stored ${data.count}, recounted ${r.counted}`);
  assert.ok(['PASS', 'FAIL'].includes(data.verdict));
  for (const t of data.tasks) if (t.quote) assert.ok(t.quote.length <= 170, t.id);
});

test('verify: a quote must be word for word, a patch span must hash the same', () => {
  const patch = '--- a/x.py\n+++ b/x.py\n+def new_name(a,  b):\n+    return a\n';
  const g = goldRef(patch, 'def new_name(a, b):');
  assert.ok(g);
  const d = { tasks: [{ id: 't1', quote: 'Rename old_name to new_name.', gold: g }, { id: 't2' }] };
  const ok = verify(d, new Map([['t1', { issue: 'Please  Rename old_name\nto new_name. Thanks', patch }]]));
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 1);
  const bad = verify(d, new Map([['t1', { issue: 'Rename old_name to other.', patch: patch.replace('new_name', 'nu_name') }]]));
  assert.deepEqual([bad.ok, bad.badQuote, bad.badGold], [false, ['t1'], ['t1']]);
  assert.deepEqual(verify(d, new Map()).missing, ['t1']);
});

test('leaklens pro-v2 prints the figure and the bar; --json carries the same count', () => {
  const out = execFileSync(process.execPath, [bin, 'pro-v2'], { encoding: 'utf8' });
  assert.match(out, new RegExp(`: ${data.count} of 642 tasks counted`));
  assert.match(out, /recount agrees/);
  const j = JSON.parse(execFileSync(process.execPath, [bin, 'pro-v2', '--json'], { encoding: 'utf8' }));
  assert.equal(j.counted, data.count);
  assert.equal(j.bar, data.bar);
});
