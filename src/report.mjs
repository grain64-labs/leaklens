// results.jsonl (one row per task, input order) and summary.md. No timestamps or paths, so the same input gives the same bytes.
import { METHODOLOGY_VERSION, WORDING, PROCEDURE_TEXT, VERIFIED_SPLIT } from './definitions.mjs';

// A path as the user typed it, quoted for a POSIX shell when it needs to be.
const sh = (p) => (/^[\w@%+=:,./~-]+$/.test(p) ? p : "'" + String(p).replace(/'/g, "'\\''") + "'");
import { rejectedLine } from './input.mjs';

export const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// The published count for the same tasks (BEN-349 item 3): when the input's IDs are in the Leaklens flag file, one line says
// what the public table counts for them, so the bold line of a rules-only run is never read as "Leaklens says".
export function publishedLine(rows, flags) {
  if (!flags || !flags.benchmarks) return null;
  const ids = rows.map((r) => r.instance_id);
  let best = null;
  for (const [slug, b] of Object.entries(flags.benchmarks)) {
    const all = new Set(b.tasks), fl = new Set(b.flagged);
    const inIt = ids.filter((id) => all.has(id));
    if (inIt.length && (!best || inIt.length > best.n)) best = { slug, b, n: inIt.length, flagged: inIt.filter((id) => fl.has(id)).length };
  }
  if (!best) return null;
  const which = best.n === ids.length ? `these ${best.n === 1 ? 'task' : best.n + ' tasks'}` : `the ${best.n} of these tasks in ${best.b.name}`;
  return `Leaklens public table for ${which}: ${best.flagged} flagged (Tier A where both checks agreed, or Tier C), methodology ${best.b.methodologyVersion}, as of ${best.b.asOf}: ${flags.source || 'https://leaklens.grain64.com'}/benchmarks/${best.slug}`;
}

export function summary(rows, { input, rerun = null, judged, model, repos, flags, procedure = judged ? 'm1.1' : 'rules', rejected = [], construction = null, reversed = false }) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const tiers = { A: count((r) => r.tier === 'A'), B: count((r) => r.tier === 'B'), C: count((r) => r.tier === 'C') };
  const flagged = count((r) => r.state === 'flag');
  const pct = (k) => (n ? ` (${Math.round((100 * k) / n)}%)` : '');
  const L = [];
  L.push(`# Leaklens check: ${input}`);
  L.push('');
  L.push(`Methodology ${METHODOLOGY_VERSION} · ${n} task${n === 1 ? '' : 's'} · ${judged ? `judged by \`${model}\` with ` : ''}${PROCEDURE_TEXT[procedure]}`);
  L.push('');
  if (reversed) { L.push('Patches reversed (`--reverse-patch`): the removed lines were checked as the solution, test-file sections dropped.'); L.push(''); }
  if (rejected.length) {
    L.push(`${rejected.length} row${rejected.length === 1 ? '' : 's'} rejected and not checked, listed under "Rejected rows" below (\`--strict\` fails the whole file instead).`);
    L.push('');
  }
  if (construction && construction.warn) {
    L.push(`Warning: this looks like a construction diff; pass \`--reverse-patch\`. In ${construction.n} of ${construction.of} patches the added lines are mostly blank or stubs (\`pass\`, \`...\`, \`raise NotImplementedError\`) and the removed lines are full bodies, so this run checked the stubs left behind, not the solution.`);
    L.push('');
  }
  L.push(judged
    ? `**${flagged} of ${n} tasks flagged${pct(flagged)}: Tier A or B read by \`${model}\`, or Tier C by rule.**`
    : `**${tiers.C} of ${n} tasks${pct(tiers.C)}: gold-patch lines in the issue or discussion (Tier C). Tier A/B not read.**`);
  L.push('');
  // BEN-848: a rules-only 0 is the weak half of the method, so it says so and gives the command that reads the rest.
  if (!judged && tiers.C === 0 && n) {
    L.push(`0 here is not "clean". Without \`--judge\` this run finds the patch-line kind only; on SWE-bench Verified that was ${VERIFIED_SPLIT.patchLine} of the ${VERIFIED_SPLIT.total} published flags. Add \`--judge\` (your API key or a local endpoint) for the quoted-sentence kind (Tier A/B):`);
    L.push('');
    const args = rerun ? `${sh(rerun.file)} --out ${sh(rerun.out)}` : `${sh(input)} --out out`;
    L.push('```sh');
    L.push(`LEAKLENS_API_KEY="$YOUR_KEY" node bin/leaklens.mjs check ${args} --judge --model "$MODEL"`);
    L.push(`node bin/leaklens.mjs check ${args} --judge --base-url http://localhost:11434/v1 --model "$MODEL"`);
    L.push('```');
    L.push('');
  }
  const pub = publishedLine(rows, flags);
  if (pub) { L.push(pub); L.push(''); }
  L.push('| Signal | Tasks |');
  L.push('|---|---|');
  if (judged) {
    L.push(`| Tier A: the text states the fix | ${tiers.A} |`);
    L.push(`| Tier B: the text points to the exact place | ${tiers.B} |`);
  }
  L.push(`| Tier C: gold-patch lines appear in the issue or discussion | ${tiers.C} |`);
  L.push(`| Links the fix PR | ${count((r) => r.fix_pr_link)} |`);
  if (judged) {
    L.push(`| Disputed (checks differ, one found a quote) | ${count((r) => r.state === 'disputed')} |`);
    L.push(`| Clear (no quoted evidence) | ${count((r) => r.state === 'clear')} |`);
  }
  if (repos) L.push(`| Fix commit located in the local clone | ${count((r) => r.fix_commit && r.fix_commit.located)} |`);
  else L.push('| Fix commit date | not checked (pass `--repos <dir>` with local clones) |');
  L.push('');
  const shown = rows.filter((r) => r.state !== 'clear' && r.state !== 'rule_clear');
  if (shown.length) {
    L.push('## Tasks to look at');
    L.push('');
    L.push(`| Task | Tier | State | Evidence |${repos ? ' Fix commit |' : ''}`);
    L.push(`|---|---|---|---|${repos ? '---|' : ''}`);
    for (const r of shown) {
      const fc = r.fix_commit ? (r.fix_commit.located ? r.fix_commit.date.slice(0, 10) : 'not located') : '';
      L.push(`| ${r.instance_id} | ${r.tier} | ${r.state} | ${cell(clip(r.verdict, 220))} |${repos ? ` ${fc} |` : ''}`);
    }
    L.push('');
  }
  if (rejected.length) {
    L.push('## Rejected rows');
    L.push('');
    for (const r of rejected) L.push(`- ${rejectedLine(r)}`);
    L.push('');
  }
  L.push(WORDING);
  L.push('');
  L.push('Tier and state definitions: DEFINITIONS.md, or https://leaklens.grain64.com/methodology. Per-task evidence (matched lines, quotes with offsets, every check) is in results.jsonl.');
  L.push('');
  return L.join('\n');
}
