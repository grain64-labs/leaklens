// SWE-bench Pro V2 (642 tasks): recount the Leaklens figure from data/swe-bench-pro-v2.json, and check every stored quote
// against your own copy of the dataset. No network, no model.
//   quote: must be word for word (whitespace-normalised) in the task's problem_statement
//   gold:  for an edit-reader flag, the patch span it matched is stored as {at, len, sha256} over the whitespace-normalised
//          patch (the patch text itself is not redistributed); the check hashes that span of your patch.
import { createHash } from 'node:crypto';

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');
export const goldRef = (patch, goldLine) => { const p = norm(patch), g = norm(goldLine), at = p.indexOf(g); return at < 0 ? null : { at, len: g.length, sha256: sha(g) }; };

export function recount(data) {
  const t = data.tasks || [];
  const counted = t.filter((x) => x.counted);
  const by = (f) => t.reduce((o, x) => ((o[x[f]] = (o[x[f]] || 0) + 1), o), {});
  const lang = {};
  for (const x of t) { const o = (lang[x.language] ||= { n: 0, counted: 0 }); o.n++; if (x.counted) o.counted++; }
  return {
    total: t.length, counted: counted.length, stored: data.count, agrees: counted.length === data.count,
    countedBy: counted.reduce((o, x) => ((o[x.counted_by] = (o[x.counted_by] || 0) + 1), o), {}),
    tier: by('tier'), editReader: by('edit_reader'), language: lang,
  };
}

// tasks: Map instance_id -> { issue (or problem_statement), patch } (the pinned ScaleAI/SWE-bench_Pro default config)
export function verify(data, tasks) {
  const out = { checked: 0, missing: [], badQuote: [], badGold: [] };
  for (const x of data.tasks || []) {
    if (!x.quote && !x.gold) continue;
    const t = tasks.get(x.id);
    if (!t) { out.missing.push(x.id); continue; }
    out.checked++;
    if (x.quote && !norm(t.issue ?? t.problem_statement).includes(norm(x.quote))) out.badQuote.push(x.id);
    if (x.gold && sha(norm(t.patch).slice(x.gold.at, x.gold.at + x.gold.len)) !== x.gold.sha256) out.badGold.push(x.id);
  }
  out.ok = !out.missing.length && !out.badQuote.length && !out.badGold.length;
  return out;
}

export function proReport(data, r, v) {
  const L = [];
  L.push(`SWE-bench Pro V2 (${data.source.dataset}, config ${data.source.config}, revision ${data.source.revision.slice(0, 7)}): ${r.counted} of ${r.total} tasks counted`);
  L.push(`rule: ${data.rule}`);
  L.push(`counted by: ${Object.entries(r.countedBy).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  L.push(`edit reader readings: ${Object.entries(r.editReader).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  for (const [l, o] of Object.entries(r.language).sort()) L.push(`  ${l}: ${o.counted} of ${o.n}`);
  L.push(r.agrees ? `recount agrees with the stored figure (${data.count})` : `RECOUNT DIFFERS: stored ${data.count}, recounted ${r.counted}`);
  if (v) L.push(v.ok ? `quotes and patch spans: ${v.checked} rows checked against your dataset copy, all match` : `CHECK FAILED: ${v.missing.length} ids missing from your file, ${v.badQuote.length} quotes not word for word, ${v.badGold.length} patch spans differ`);
  else L.push('add --tasks <file> (the dataset as JSONL) to check every quote and patch span against your own copy');
  L.push(`verdict of the bar: ${data.verdict}. The bar: ${data.bar}`);
  return L.join('\n');
}
