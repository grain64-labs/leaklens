// The one source of the tier and state definitions. DEFINITIONS.md in this repository and the tier table on
// https://leaklens.grain64.com/methodology are both generated from this file.

export const METHODOLOGY_VERSION = 'm1.1';

// The procedure a run actually used (BEN-349 item 4). 'm1.1' is the published one, the same as the Leaklens tables and the
// hosted audit: check 1 at reasoning effort low, check 2 at medium, a third check at medium on splits Tier C does not settle.
export function procedureOf({ judged, tiebreak = true, effort = true }) {
  if (!judged) return 'rules';
  return 'm1.1' + (tiebreak ? '' : '-no-tiebreak') + (effort ? '' : '-no-effort');
}
export const PROCEDURE_TEXT = {
  rules: 'deterministic rules only, no network and no model (add `--judge` for Tier A/B)',
  'm1.1': 'the published m1.1 procedure: two checks (reasoning effort low, then medium) and a third on splits, as on the Leaklens tables',
  'm1.1-no-tiebreak': 'two checks (reasoning effort low, then medium), no third check on splits (--no-tiebreak): not the published m1.1 procedure',
  'm1.1-no-effort': 'two checks and a third on splits, no reasoning effort sent (--no-reasoning-effort): not the published m1.1 procedure',
  'm1.1-no-tiebreak-no-effort': 'two checks, no third check and no reasoning effort sent (--no-tiebreak --no-reasoning-effort): not the published m1.1 procedure',
};

// Evidence tiers, strongest first. `model: true` means the tier needs the judge (--judge); the others are deterministic.
export const TIERS = [
  {
    id: 'A',
    label: 'Tier A',
    meaning: 'The issue or discussion states the change that fixes the problem: replacement code, a diff, or a sentence naming the exact edit.',
    how: 'Model verdict, with every quote checked as a word-for-word substring of the text.',
    model: true,
  },
  {
    id: 'B',
    label: 'Tier B',
    meaning: 'The text names the exact file, function or line to change, without giving the change.',
    how: 'Model verdict with the same quote check. Shown separately from Tier A.',
    model: true,
  },
  {
    id: 'C',
    label: 'Tier C',
    meaning: 'Added lines of the gold patch appear in the issue or discussion.',
    how: 'Deterministic string match after whitespace normalisation. No model.',
    model: false,
  },
  {
    id: 'link',
    label: 'Links the fix PR',
    meaning: 'The issue text or the discussion links the pull request whose change is the gold patch.',
    how: 'Deterministic: a link to the instance’s own pull-request number, found by string match. Shown as its own signal; it does not change the tier.',
    model: false,
  },
  {
    id: 'none',
    label: 'No quoted evidence',
    meaning: 'Nothing in the text states or points to the fix.',
    how: 'A finding about the text only, not proof that the task is clean.',
    model: false,
  },
];

// One tier per task (BEN-366): the order in which the tiers are given, said once for the site and DEFINITIONS.md.
export const PRECEDENCE = 'Each task is counted under one tier, in the order A, then C, then B. A task whose text repeats added lines of the gold patch (the Tier C rule) and also states the fix is counted as Tier A, so a table\u2019s Tier C count is the tasks that are Tier C only. A run without `--judge` reads no Tier A, so it reports every task the rule matches as Tier C.';

// How a task reads in a report. Exactly one state per task.
export const STATES = [
  { id: 'flag', meaning: 'Tier A, B or C: the text hands over the fix or its exact place. Tier A and B count only when both checks agree (or a third check settles them).' },
  { id: 'disputed', meaning: 'The checks differ and at least one found a quote. Not counted as a flag, never read as clear; the quote is shown.' },
  { id: 'link', meaning: 'No tier, but the issue or discussion links the fix pull request.' },
  { id: 'clear', meaning: 'Both checks found no quoted evidence and no rule matched. Not proof the task is clean.' },
  { id: 'rule_clear', meaning: 'Checked by the deterministic rules only (no --judge): no Tier C match and no fix-PR link. The text was not read by a model.' },
];

// BEN-848 (R BEN-841 item 1): on SWE-bench Verified (m1.1, 2026-11-08) the published flags by kind. A rules-only run finds only
// the patch-line kind (Tier C); site-build.mjs stops the build when these differ from the public CSV.
export const VERIFIED_SPLIT = { patchLine: 18, total: 149 };

// Wording rule for every output: what the public text and history contain, never a claim about training.
export const WORDING = 'A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.';
