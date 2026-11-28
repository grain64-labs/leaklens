#!/usr/bin/env node
// leaklens: per-task solution-leakage check for coding benchmarks. Runs on your machine.
import fs from 'node:fs';
import path from 'node:path';
import { readTasks, InputError, constructionCount } from '../src/input.mjs';
import { checkAll } from '../src/check.mjs';
import { makeClient, JudgeError } from '../src/judge.mjs';
import { toJsonl, summary } from '../src/report.mjs';
import { METHODOLOGY_VERSION, procedureOf } from '../src/definitions.mjs';
import { parseResolved, rescore, report, inputNotes, RescoreInputError } from '../src/rescore.mjs';
import { recount, verify, proReport } from '../src/pro-v2.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `leaklens ${VERSION} (methodology ${METHODOLOGY_VERSION})

Usage: leaklens check <benchmark.jsonl> [options]
       leaklens rescore <results> [--benchmark verified|lite] [--label <name>] [--json]
       leaklens pro-v2 [--tasks <swe-bench-pro.jsonl>] [--json]

Reads SWE-bench-style tasks (JSONL or a JSON array; fields instance_id, problem_statement, patch,
optional repo, hints_text, created_at) and writes, per task, the tier, state and evidence.

With no options: no network and no model. Prints Tier C (gold-patch lines in the issue or
discussion) and whether the text links the fix pull request. Rows without an instance_id,
problem_statement or patch (or a duplicate id) are listed with their line and reason; the rest
are checked.

Options:
  --out <dir>          where results.jsonl and summary.md go (default: leaklens-out)
  --repos <dir>        local git clones (owner_name.git, owner_name, name or owner/name under <dir>,
                       or <dir> itself): adds the upstream fix commit and its date. No network.
  --judge              add Tier A/B on your own OpenAI-compatible endpoint, with the published m1.1
                       procedure: two differently worded checks (reasoning effort low, then medium),
                       a third on splits, every quote checked word for word. 2-3 calls a task
  --model <name>       model for --judge (or LEAKLENS_MODEL)
  --base-url <url>     endpoint for --judge (or LEAKLENS_BASE_URL / OPENAI_BASE_URL;
                       default https://api.openai.com/v1; a local server such as
                       http://localhost:11434/v1 needs no key)
                       key: LEAKLENS_API_KEY or OPENAI_API_KEY (read from the environment, never printed)
  --no-tiebreak        with --judge: skip the third check (2 calls a task; labelled m1.1-no-tiebreak)
  --no-reasoning-effort  with --judge: do not send reasoning_effort, for models that refuse it
                       (labelled m1.1-no-effort). --tiebreak and --reasoning-effort are the default
  --strict             one rejected row fails the whole file: nothing checked, exit 2
  --reverse-patch      the patch is a task-construction diff (it strips the feature out, FeatureBench
                       style): swap added and removed lines and drop test-file sections before checking
  --concurrency <n>    parallel tasks with --judge (default 4)
  --fresh              with --judge: re-judge tasks already in <out>/results.jsonl
  --quiet              print nothing but errors
  -h, --help           this text
  -v, --version        version

rescore: your score on all tasks and on the tasks outside the Leaklens headline flags.
  <results>            resolved IDs: SWE-bench results.json ("resolved"), an sb-cli or harness report
                       ("resolved_ids"), a per-instance report.json, JSONL with instance_id and resolved,
                       or a plain list of IDs; - reads standard input. No network, no model.
  --benchmark <name>   verified or lite (default: the one holding most of the IDs; Verified on a tie)
  --label <name>       the model name in the table row (default: your model)
  --json               print the numbers as JSON
  --flags <file>       another flag file (default: data/headline-flags.json, the Leaklens dataset's flags)

pro-v2: the Leaklens figure for SWE-bench Pro V2 (642 tasks), recounted from data/swe-bench-pro-v2.json.
  --tasks <file>       your copy of ScaleAI/SWE-bench_Pro (default config) as JSONL or JSON: every stored
                       quote and patch span is checked word for word against it. No network, no model.
  --json               print the numbers as JSON

Exit codes: 0 checked, 1 judge or git error, 2 bad input or usage.
Definitions: DEFINITIONS.md, https://leaklens.grain64.com/methodology`;

function parseArgs(argv) {
  const o = { _: [] };
  const takes = new Set(['out', 'repos', 'model', 'base-url', 'concurrency', 'benchmark', 'label', 'flags', 'tasks']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (takes.has(k)) {
        const val = v !== undefined ? v : argv[++i];
        if (val === undefined || val.startsWith('--')) throw new InputError(`--${k} needs a value`);
        o[k] = val;
      } else if (['judge', 'tiebreak', 'reasoning-effort', 'no-tiebreak', 'no-reasoning-effort', 'fresh', 'quiet', 'json', 'strict', 'reverse-patch'].includes(k)) o[k] = true;
      else throw new InputError(`unknown option --${k} (see leaklens --help)`);
    } else o._.push(a);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.version) return console.log(VERSION);
  if (o.help || !o._.length) return console.log(HELP);
  const [cmd, file, ...extra] = o._;
  if (cmd === 'rescore') return rescoreCmd(o, file, extra);
  if (cmd === 'pro-v2') return proV2Cmd(o, file);
  if (cmd !== 'check') throw new InputError(`unknown command "${cmd}" (try: leaklens check <benchmark.jsonl>, leaklens rescore <results> or leaklens pro-v2)`);
  if (!file) throw new InputError('leaklens check needs a benchmark file');
  if (extra.length) throw new InputError(`unexpected argument "${extra[0]}"`);
  for (const k of ['tiebreak', 'no-tiebreak', 'reasoning-effort', 'no-reasoning-effort']) if (o[k] && !o.judge) throw new InputError(`--${k} needs --judge`);
  if (o.tiebreak && o['no-tiebreak']) throw new InputError('--tiebreak and --no-tiebreak contradict each other');
  if (o['reasoning-effort'] && o['no-reasoning-effort']) throw new InputError('--reasoning-effort and --no-reasoning-effort contradict each other');
  const tiebreak = !o['no-tiebreak'], effort = !o['no-reasoning-effort'];
  const procedure = procedureOf({ judged: !!o.judge, tiebreak, effort });
  if (o.repos && !fs.existsSync(o.repos)) throw new InputError(`--repos ${o.repos}: no such directory`);
  const { tasks, rejected } = readTasks(file, { strict: !!o.strict, reversePatch: !!o['reverse-patch'] });
  const construction = o['reverse-patch'] ? null : constructionCount(tasks);
  const outDir = o.out || 'leaklens-out';
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) throw new InputError(`--out ${outDir}: is a file, not a directory`);
  const log = (s) => { if (!o.quiet) process.stderr.write(s + '\n'); };

  let client = null;
  let model = null;
  if (o.judge) {
    model = o.model || process.env.LEAKLENS_MODEL;
    if (!model) throw new InputError('--judge needs --model <name> (or LEAKLENS_MODEL)');
    const baseUrl = o['base-url'] || process.env.LEAKLENS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.LEAKLENS_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!apiKey && /api\.openai\.com/.test(baseUrl)) throw new InputError('--judge on api.openai.com needs a key in LEAKLENS_API_KEY or OPENAI_API_KEY');
    client = makeClient({ baseUrl, model, apiKey, effort });
    log(`judging ${tasks.length} tasks with ${model} at ${baseUrl}: ${tiebreak ? '2-3' : '2'} model calls per task (${procedure})`);
  }

  // A judged run resumes: tasks already judged with the same model and options in <out>/results.jsonl are reused.
  let reuse = null;
  const prev = path.join(outDir, 'results.jsonl');
  if (client && !o.fresh && fs.existsSync(prev)) {
    reuse = new Map();
    for (const l of fs.readFileSync(prev, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        const sameRepos = !!r.fix_commit === !!o.repos;
        const sameSide = !!r.patch_reversed === !!o['reverse-patch'];
        if (r.judge && r.judge.model === model && sameRepos && sameSide && r.procedure === procedure) reuse.set(r.instance_id, r);
      } catch {}
    }
    if (reuse.size) log(`reusing ${reuse.size} tasks already judged in ${prev} (--fresh to re-judge)`);
  }

  let done = 0;
  const { rows, error } = await checkAll(tasks, { reposDir: o.repos || null, client, tiebreak: !!client && tiebreak, effort: !!client && effort, concurrency: o.concurrency ? parseInt(o.concurrency, 10) : 4, reuse }, (i, r, reused) => {
    done++;
    if (client || o.repos) log(`[${done}/${tasks.length}] ${r.instance_id}: ${r.tier} ${r.state}${reused ? ' (reused)' : ''}`);
  });

  fs.mkdirSync(outDir, { recursive: true });
  if (error) {
    // Keep what finished so the next run resumes from it instead of paying for those calls again.
    // Earlier judged rows for tasks this run did not reach are kept too.
    const got = new Set(rows.map((r) => r.instance_id));
    const keep = [...rows, ...(reuse ? [...reuse.values()].filter((r) => !got.has(r.instance_id)) : [])];
    if (keep.length) fs.writeFileSync(prev, toJsonl(keep));
    const kept = keep.length ? `; ${keep.length} of ${tasks.length} tasks finished and kept in ${prev}, run again to resume` : '';
    throw new JudgeError(error.message + kept);
  }
  fs.writeFileSync(path.join(outDir, 'results.jsonl'), toJsonl(rows));
  let flags = null;
  try { flags = JSON.parse(fs.readFileSync(o.flags || new URL('../data/headline-flags.json', import.meta.url), 'utf8')); } catch (e) { if (o.flags) throw new InputError(`cannot read the flag file ${o.flags}: ${e.code || e.message}`); }
  const md = summary(rows, { input: path.basename(file), rerun: { file, out: outDir }, judged: !!client, model, repos: !!o.repos, flags, procedure, rejected, construction, reversed: !!o['reverse-patch'] });
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  if (!o.quiet) {
    process.stdout.write(md);
    process.stdout.write(`\nWrote ${path.join(outDir, 'results.jsonl')} and ${path.join(outDir, 'summary.md')}\n`);
  }
}

function proV2Cmd(o, extra) {
  if (extra) throw new InputError(`unexpected argument "${extra}" (pro-v2 takes --tasks <file>)`);
  const data = JSON.parse(fs.readFileSync(new URL('../data/swe-bench-pro-v2.json', import.meta.url), 'utf8'));
  const r = recount(data);
  let v = null;
  if (o.tasks) {
    const { tasks } = readTasks(o.tasks);
    v = verify(data, new Map(tasks.map((t) => [t.instance_id, t])));
  }
  if (o.json) console.log(JSON.stringify({ verdict: data.verdict, rule: data.rule, bar: data.bar, ...r, check: v }, null, 2));
  else console.log(proReport(data, r, v));
  if (!r.agrees || (v && !v.ok)) process.exitCode = 1;
}

function rescoreCmd(o, file, extra) {
  if (!file) throw new InputError('leaklens rescore needs a results file (or - for standard input)');
  if (extra.length) throw new InputError(`unexpected argument "${extra[0]}"`);
  for (const k of ['judge', 'tiebreak', 'repos', 'out', 'model', 'strict', 'reverse-patch']) if (o[k]) throw new InputError(`--${k} does not apply to rescore`);
  let text;
  try { text = fs.readFileSync(file === '-' ? 0 : file, 'utf8'); } catch (e) { throw new InputError(`cannot read ${file}: ${e.code || e.message}`); }
  const flagsFile = o.flags || new URL('../data/headline-flags.json', import.meta.url);
  let flags;
  try { flags = JSON.parse(fs.readFileSync(flagsFile, 'utf8')); } catch (e) { throw new InputError(`cannot read the flag file ${flagsFile}: ${e.code || e.message}`); }
  const parsed = parseResolved(text);
  const r = rescore(parsed.ids, flags, o.benchmark);
  if (o.json) return console.log(JSON.stringify({ ...r, input: { format: parsed.format, ids: parsed.ids.length, notResolved: parsed.notResolved, ignored: parsed.ignored } }, null, 2));
  if (!o.quiet) {
    process.stderr.write(`read ${parsed.ids.length} resolved ID${parsed.ids.length === 1 ? '' : 's'} (${parsed.format}) from ${file === '-' ? 'standard input' : path.basename(file)}\n`);
    for (const n of inputNotes(parsed)) process.stderr.write(n + '\n');
  }
  console.log(report(r, o.label));
}

main().catch((e) => {
  process.stderr.write(`leaklens: ${e.message}\n`);
  process.exit(e instanceof InputError || e instanceof RescoreInputError ? 2 : 1);
});
