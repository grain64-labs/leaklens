# Leaklens

Leaklens checks a coding benchmark for tasks whose own text hands over the fix: the issue or its comments state the change, or lines of the gold patch reappear in the text. It writes one row per task, with the sentence quoted, the tier and, if you point it at a local clone, the date of the upstream fix commit. It runs on your machine. The patch-overlap tier needs no network and no model; the quoted-sentence tier uses your own API key or a local endpoint. "Flagged" means the task text hands over the fix. It says nothing about what any model did.

![Leaklens on SWE-bench Verified: type a task id, see the flag and the quoted sentence from the issue that states the fix](media/leaklens-demo.gif)

The hosted tables at [leaklens.grain64.com](https://leaklens.grain64.com/?ref=gh-1) have every SWE-bench Verified and Lite task checked already ([the same demo as an MP4 with captions, under a minute](https://leaklens.grain64.com/leaklens-demo.mp4)). This repository is the engine behind them, for your own tasks.

## Check our flags

Check our flags yourself: 16 tasks, about 15 minutes, every answer published on the page, agreeing or not. Each row gives the quote from the task and the gold-patch line it matches: [open the checklist](https://leaklens.grain64.com/validation?ref=gh-1#person-check).

## Quickstart

Clone this repository and run these from its folder. Node 18.17 or later; there is nothing to install (no dependencies).

```sh
node bin/leaklens.mjs check fixtures/swe-bench-verified-10.jsonl --out out    # 10 SWE-bench Verified tasks: no network, no model
diff -r out fixtures/expected && echo "same as fixtures/expected"            # byte-for-byte the checked-in result
node bin/leaklens.mjs check tasks.jsonl --out my-out                          # your benchmark file (SWE-bench JSONL or a JSON array)
node bin/leaklens.mjs check tasks.jsonl --out my-out --repos ~/src            # adds the upstream fix commit and its date from your clones
LEAKLENS_API_KEY="$YOUR_KEY" node bin/leaklens.mjs check tasks.jsonl --out my-out --judge --model "$MODEL"   # Tier A/B on your key, the published m1.1 procedure
node bin/leaklens.mjs check tasks.jsonl --out my-out --judge --base-url http://localhost:11434/v1 --model "$MODEL"   # or a local model
```

The first line prints this (also written to `out/summary.md`; per-task evidence is in `out/results.jsonl`). The bold line counts only what was measured: without `--judge` that is Tier C. The line under it is the Leaklens public table's count for the same task IDs (Tier A where both checks agreed, or Tier C), read from `data/headline-flags.json`; it is left out when none of your IDs are in the table.

```markdown
# Leaklens check: swe-bench-verified-10.jsonl

Methodology m1.1 · 10 tasks · deterministic rules only, no network and no model (add `--judge` for Tier A/B)

**5 of 10 tasks (50%): gold-patch lines in the issue or discussion (Tier C). Tier A/B not read.**

Leaklens public table for these 10 tasks: 6 flagged (Tier A where both checks agreed, or Tier C), methodology m1.1, as of 2026-11-08: https://leaklens.grain64.com/benchmarks/swe-bench-verified

| Signal | Tasks |
|---|---|
| Tier C: gold-patch lines appear in the issue or discussion | 5 |
| Links the fix PR | 3 |
| Fix commit date | not checked (pass `--repos <dir>` with local clones) |

## Tasks to look at

| Task | Tier | State | Evidence |
|---|---|---|---|
| astropy__astropy-14539 | C | flag | 1 of 1 added patch lines appear in the issue or discussion. |
| astropy__astropy-14995 | C | flag | 1 of 1 added patch lines appear in the issue or discussion. |
| django__django-10097 | none | link | The issue text links the pull request that is the fix. |
| django__django-12273 | C | flag | 2 of 3 added patch lines appear in the issue or discussion. |
| django__django-13012 | C | flag | 2 of 2 added patch lines appear in the issue or discussion. |
| django__django-14539 | none | link | The discussion links the pull request that is the fix. |
| django__django-15525 | C | flag | 3 of 3 added patch lines appear in the issue or discussion. |

A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.

Tier and state definitions: DEFINITIONS.md, or https://leaklens.grain64.com/methodology. Per-task evidence (matched lines, quotes with offsets, every check) is in results.jsonl.
```

`npm install -g .` gives you a `leaklens` command instead of `node bin/leaklens.mjs`. `node bin/leaklens.mjs --help` lists every option.

## Use as an agent skill

`skills/leaklens/SKILL.md` lets Claude Code or Codex run these checks for you. It uses this CLI on your machine, says how many model calls a `--judge` run makes and asks before starting it, and reports flags in the wording below.

```sh
git clone --depth 1 https://github.com/grain64-labs/leaklens
cd leaklens

# Claude Code
mkdir -p ~/.claude/skills && cp -R skills/leaklens ~/.claude/skills/leaklens

# Codex
mkdir -p ~/.agents/skills && cp -R skills/leaklens ~/.agents/skills/leaklens
```

Then ask: "Use the leaklens skill to check tasks.jsonl for solution leakage and tell me which tasks to look at."

## Your score, outside the headline flags

`rescore` takes your SWE-bench per-instance results and prints your score on all tasks and on the tasks outside the Leaklens headline flags (Tier A where both checks agreed on a quote that states the fix, or Tier C). It also lists the headline-flagged tasks your model solved, a markdown table row and a citation line. It runs locally, with no network and no model. The flags are the Leaklens headline flags for SWE-bench Verified and Lite (`data/headline-flags.json`, the same flags as the Leaklens dataset and https://leaklens.grain64.com/rescore).

```sh
node bin/leaklens.mjs rescore fixtures/rescore/20251205_sonar-foundation-agent_claude-opus-4-5.json   # a public leaderboard entry
node bin/leaklens.mjs rescore results.json --label "my-agent"       # results.json ("resolved"), sb-cli report ("resolved_ids"), report.json, JSONL, an ID list, or a CSV/list with a status per ID
node bin/leaklens.mjs rescore lite-ids.txt --benchmark lite --json  # Lite; numbers as JSON
```

The first line prints (task list shortened):

```text
SWE-bench Verified (Leaklens headline flags, methodology m1.1, as of 2026-11-08)

  All 500 tasks                              79.2%  (396 resolved)
  351 tasks outside the 149 headline flags   74.1%  (260 resolved)   change −5.1 points
  149 headline-flagged tasks                 91.3%  (136 resolved)
  Headline flags: Tier A where both checks agreed on a quote that states the fix, or Tier C.
  The tasks outside the headline flags are not a clean set: they include tasks a third check settled as stating the fix, tasks that point to the fix, and disputed tasks. Those are counted apart from the headline, not removed.
```

IDs that are not in the benchmark are listed and left out of every count. A fix commit dated before a cutoff shows that exposure was possible, not that a model trained on it.

## SWE-bench Pro V2

`data/swe-bench-pro-v2.json` holds the Leaklens reading of all 642 tasks of SWE-bench Pro V2 (`ScaleAI/SWE-bench_Pro`, config `default`, revision `2d52cb3`). **2 of 642 are counted**: both are Tier A, where both checks agreed on a quote that states the fix. None are Tier C. **2 is a floor, not a clean count.** A first blind AI read of 30 tasks that were not counted found that 6 of them state the fix. Pro V2 statements often describe the refactor itself, and Tier A's rule asks for the fix text. An added reader for statements that name the edit (the `edit_reader` column) flagged 71 more, but it fails the same bar: a fresh blind AI read of 30 tasks it did not count still found 5 that state the fix (given as the cause, the steps or the helpers to replace), and 8 of 30 of its flags only described wanted behaviour, so none of the 71 is counted. The file also carries each task's tier, the extra edit reader's label, and the quote (at most 170 characters). It holds no problem statement and no patch.

**Estimated, not counted: about 146 of 642 state the fix (23%; 95% range 76 to 263, or 12% to 41%).** It comes from the two blind reads of 30. 22 of 30 of the 71 flags held, so about 52 of the 71 state the fix. 5 of 30 of the 546 other uncounted tasks not read before stated the fix, so about 91 of those do. Add the 2 counted and 1 more found in the first read. The range joins each sample's 97.5% Wilson interval, so both hold together at least 95% of the time. The estimate says how many, not which. To clean Pro V2, start with the 71 rows whose `edit_reader` is `names_edit_strict`: about 3 in 4 hold on a blind read, and none is counted. How it is worked out: https://leaklens.grain64.com/benchmarks/swe-bench-pro#estimate

```sh
node bin/leaklens.mjs pro-v2                       # recount the figure from the shipped file
node bin/leaklens.mjs pro-v2 --tasks pro-v2.jsonl  # also check every quote and patch span against your own copy
```

To make `pro-v2.jsonl` (needs the Python `datasets` package):
`load_dataset("ScaleAI/SWE-bench_Pro", split="test", revision="2d52cb3df914a3fcf80c7f66738b3a88ae37fc50").to_json("pro-v2.jsonl")`.
The same rows are on Hugging Face as the `swe-bench-pro-v2` config of `grain64-labs/leaklens-swe-bench`. How they were checked: https://leaklens.grain64.com/benchmarks/swe-bench-pro#bar

## What a flag is and is not

- **Tier A**: the issue or discussion states the change that fixes the problem (replacement code, a diff, or a sentence naming the exact edit).
- **Tier B**: the text names the exact file, function or line to change, without giving the change. Shown apart from Tier A.
- **Tier C**: added lines of the gold patch appear in the issue or discussion. A deterministic string match; no model.
- **Links the fix PR**: the text links the pull request whose change is the gold patch. Its own signal; it does not change the tier.
- **Fix commit date** (`--repos`): when the upstream fix was committed. Shown, never scored.

Tier A and B come from two differently worded model checks (`--judge`). Every quote is checked word for word against the task text, and a tier counts only when both checks agree; a third check settles splits. Tasks where the checks differ are marked `disputed`, never `clear`. A flag is a finding about the text and history. It never says a model was trained on a task or memorised it.

[DEFINITIONS.md](DEFINITIONS.md) has every tier and state. It is generated from `src/definitions.mjs`, the same file the tier table on https://leaklens.grain64.com/methodology is built from; the judge prompts (`src/prompts.mjs`) and rules (`src/rules.mjs`) are the ones the hosted tables run.

## How far to trust it

From https://leaklens.grain64.com/validation, SWE-bench Verified, as of methodology m1.1, 8 Nov 2026. Each sampled task was labelled once by a language model, reading the quoted text beside the gold patch, with no second labeller, so the figures measure agreement with that reading:

- Tier A: 39 of 39 sampled flags held up (95% interval 91 to 100%).
- Tier C: 17 of 18 held up (95% interval 74 to 99%).
- Unflagged is not clean: 4 of 47 unflagged tasks read were found to leak (9%, 95% interval 3 to 20%).

## Input and output

Input: one task per line (or a JSON array) with `instance_id`, `problem_statement` and `patch`; `repo`, `hints_text` and `created_at` are used when present (`repo` defaults from the SWE-bench id, `owner__name-1234`). A row without one of the three (or with a duplicate `instance_id`) is not checked: the summary lists it under "Rejected rows" with its line and reason, and every other row is checked. `--strict` fails the whole file instead (nothing checked, exit 2).

### Your benchmark's format

Three things to set before the first run on a new benchmark's own files:

- **PR number.** The fix-PR link check needs the pull request number: give each row an integer `pr_number`. Without it the number is read from an `instance_id` that ends in `-1234` (SWE-bench style). An id that ends in `_1234` (OmniCode's java and cpp rows) gets none, and the link check then has nothing to match.
- **Rows with an empty `patch`.** They are listed as rejected (line and reason) and the rest of the file is checked; nothing to drop by hand. OmniCode's six files as downloaded give 638 checked and 271 rejected (its cpp and java style rows ship an empty `patch`). Add `--strict` if one bad row should fail the run. (Engine v2 rejected the whole file on one such row: drop them first there.)
- **Which way the diff runs.** The check compares the lines the gold patch *adds* with the issue text. A file whose `patch` is the task-construction diff, which strips the feature out of the repo (FeatureBench's), has the solution on the removed side. When at least half the patches look like that (added lines mostly blank or stubs such as `pass`, `...`, `raise NotImplementedError`; removed lines full bodies), the summary says "this looks like a construction diff; pass `--reverse-patch`". `--reverse-patch` swaps added and removed lines and drops test-file sections (`tests/`, `test_*.py`, `*_test.*`, `conftest.py`); each row then carries `"patch_reversed": true`. On FeatureBench's full split as shipped, 164 of 166 patches look like construction diffs; on SWE-bench Verified, 0 of 500.

Output, in `--out` (default `leaklens-out`): `results.jsonl`, one row per task in input order (tier, state, verdict, matched patch lines, fix-PR link with offsets, fix commit, every judge check with its quotes and offsets), and `summary.md`. No timestamps or paths, so the same input gives the same bytes.

`--judge` runs the published m1.1 procedure, the one behind the Leaklens tables: two checks (reasoning effort low, then medium) and a third on splits that Tier C does not settle, so two or three model calls per task, four tasks at a time (`--concurrency`). `--judge --model <model>` is all it takes to reproduce the table's method; the difference that remains is your model. `--no-tiebreak` saves the third call and `--no-reasoning-effort` is for models that refuse that field; either way the run is labelled with what ran (`procedure` on every row and in the summary: `m1.1`, `m1.1-no-tiebreak`, `m1.1-no-effort`), and a rerun only reuses rows judged with the same model and procedure. The key is read from `LEAKLENS_API_KEY` or `OPENAI_API_KEY` and only sent to the endpoint you choose; a local server needs none. If a call fails, finished tasks are kept in `results.jsonl` and the next run resumes from them.

## Tests

`npm test` runs the CLI end to end: the fixture byte for byte, `--judge` against a local stub serving the answers the hosted tables recorded for the same 10 tasks (`fixtures/judge-recorded.json`), resume after a failure, input errors, and a fix-commit lookup in a throwaway git repository. No test calls a model or the network.

`fixtures/stored-verdicts.csv` is the 10 fixture tasks' rows from the public per-task CSV download (https://leaklens.grain64.com/api/export.csv?benchmark=swe-bench-verified), cut to 8 of its columns. The tests check that the CLI gives the same Tier C matches and fix-PR links (and, with `--judge` on the recorded answers, the same tier, state and agreement) as the hosted table.

## What is not here

The hosted site's code, its database, the API and accounts stay closed. The per-task verdicts themselves are public: SWE-bench Verified is downloadable as CSV from https://leaklens.grain64.com/benchmarks/swe-bench-verified.

## Licence

MIT, for the code. The 10 fixture tasks (`fixtures/`) are copied from SWE-bench Verified: issue text from GitHub, and patches from astropy (BSD-3-Clause), django (BSD-3-Clause) and requests (Apache-2.0), which stay under their own licences. The SWE-bench Verified dataset card states no licence of its own.
