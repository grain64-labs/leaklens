// The edit reader (BEN-806, prompt version ben806-edit-v1): one question asked of a task whose statement was rewritten by the
// benchmark (SWE-bench Pro V2): does the text name the edit the gold patch makes? Tier A asks for the fix itself (code, a diff,
// "change X to Y"); rewritten statements more often describe a refactor (remove, move, rename, migrate, split), which Tier A
// reads as B, split or clear. This reader counts that description when it names existing code and what to do with it.
// The hosted service imports this file (api/src/index.ts, POST /api/pipeline/edit-read). The prompt is frozen once the first
// reading lands: a change after that is a new reader with a new bar file, not a fix.
export const EDIT_PROMPT_VERSION = 'ben806-edit-v1';

const MAX_ISSUE = 14000;
const MAX_HINTS = 10000;
const MAX_PATCH = 6000;

export const EDIT_SYSTEM = `You read one task from a coding benchmark. You get the task statement a solver is given (ISSUE), comments (HINTS, often empty) and the gold patch that solved it (PATCH; the solver never sees it). Some benchmarks rewrite the statement and, in doing so, describe the code change itself. Your one question: does the ISSUE or HINTS text name the edit the PATCH makes, so that a solver who reads it knows which existing code to change and what to do to it, without working out the approach?

Labels:
- "names_edit": the text does at least one of these for the core of the patch:
  * it gives code, a diff or a replacement line;
  * it names an existing code element (function, method, class, type, module, file, package, library, config key) and says what to do with it: remove it, move it to a named place, rename it, replace it with a named element, migrate it from one named library or API to another, split it into named parts, change its signature or type in a stated way, make it return or raise a stated thing;
  * it names a new element and the existing named code it replaces or that must use it.
- "behaviour": the text says only what the program should do (inputs, outputs, rules, error messages, a feature, or a public name that must exist) and leaves how to change the existing code to the solver. A wish to "centralize", "refactor", "unify" or "clean up" something without naming what moves where, or what replaces what, is behaviour. A reproduction, a traceback or a symptom is behaviour.
- "none": the text is vague about both what should happen and what to change.

Strictness, for "names_edit": "strict" when the named edit is the core of the patch (most of what the patch does follows from it); "partial" when it names only a minor part of the patch, or when you are unsure. For "behaviour" and "none", strictness is "strict".

Evidence, for "names_edit": "where" is "issue" or "hints"; "quote" is the one passage that names the edit, copied character for character from that field (at most 400 characters; do not fix typos, do not add or drop backticks, do not join two passages); "gold_line" is one line of the PATCH that the passage gives or points to, copied character for character without the leading + or - sign. For "behaviour" and "none", set where to "-" and quote and gold_line to "".
"note": one short sentence on why, in plain words.
Judge only the text you are given. Do not use anything you may remember about this project or this task.`;

export const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'strictness', 'where', 'quote', 'gold_line', 'note'],
  properties: {
    label: { type: 'string', enum: ['names_edit', 'behaviour', 'none'] },
    strictness: { type: 'string', enum: ['strict', 'partial'] },
    where: { type: 'string', enum: ['issue', 'hints', '-'] },
    quote: { type: 'string' },
    gold_line: { type: 'string' },
    note: { type: 'string' },
  },
};

const cut = (s, n) => (s.length > n ? s.slice(0, n) + `\n[... cut, ${s.length - n} more characters]` : s);

export function editPrompt(issue, hints, patch, retry) {
  return `ISSUE:\n${cut(issue, MAX_ISSUE)}\n\nHINTS:\n${hints && hints.trim() ? cut(hints, MAX_HINTS) : '(no comments)'}\n\nPATCH:\n${cut(patch, MAX_PATCH)}` +
    (retry ? `\n\nYour previous answer was refused: ${retry}. Answer again. Copy the quote and the gold line character for character from the text above.` : '');
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripSign = (s) => String(s ?? '').replace(/^\s*[+-](?![+-])/, '');

// A reply becomes a reading only when the quote is word for word (whitespace-normalised) in the named field and the gold line
// is in the patch. Anything else is refused and asked again (the caller decides how often).
export function checkEdit(raw, issue, hints, patch) {
  if (!raw || typeof raw !== 'object') return { error: 'no JSON answer' };
  const label = raw.label;
  if (!['names_edit', 'behaviour', 'none'].includes(label)) return { error: `label "${String(label).slice(0, 30)}" is not one of names_edit, behaviour, none` };
  const note = String(raw.note ?? '').slice(0, 400);
  if (!norm(note)) return { error: 'the note is empty' };
  if (label !== 'names_edit') return { reading: { label, strictness: 'strict', where: '-', quote: '', gold_line: '', note } };
  const strictness = raw.strictness;
  if (!['strict', 'partial'].includes(strictness)) return { error: 'strictness must be strict or partial' };
  const where = raw.where;
  if (where !== 'issue' && where !== 'hints') return { error: 'where must be issue or hints for names_edit' };
  const quote = String(raw.quote ?? '').trim(), gold = stripSign(String(raw.gold_line ?? '')).trim();
  if (!norm(quote)) return { error: 'the quote is empty' };
  const field = where === 'issue' ? issue : hints;
  if (!norm(field).includes(norm(quote))) return { error: `the quote is not word for word in the ${where === 'issue' ? 'ISSUE' : 'HINTS'}` };
  if (!norm(gold) || !norm(patch).includes(norm(gold))) return { error: 'the gold_line is not a line of the PATCH' };
  return { reading: { label, strictness, where, quote, gold_line: gold, note } };
}

// The counted rule of pipeline/ben-pro2r-bar.md: a reading flags a task only as names_edit + strict (quote and gold line checked).
export const editFlag = (reading) => !!reading && reading.label === 'names_edit' && reading.strictness === 'strict';
