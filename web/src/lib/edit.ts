import type { LocalizedText, Problem } from './api/types';

/** Field errors of a problem+json response, keyed by the contract field path (e.g. `content.grades[0].value`). */
export type FieldErrors = Record<string, string>;

export function fieldErrors(problem: Problem | undefined | null): FieldErrors {
  const out: FieldErrors = {};
  for (const e of problem?.errors ?? []) out[e.field] = e.message;
  return out;
}

/** Errors at a path or below it: `errorsUnder(errs, 'content.features')`. */
export function errorsUnder(errs: FieldErrors, prefix: string): string[] {
  return Object.entries(errs)
    .filter(([f]) => f === prefix || f.startsWith(`${prefix}.`) || f.startsWith(`${prefix}[`))
    .map(([f, m]) => (f === prefix ? m : `${f.slice(prefix.length).replace(/^\./, '')}: ${m}`));
}

/** Drops empty translations; returns undefined when nothing is left ("no data"). */
export function cleanText(text: LocalizedText | undefined | null): LocalizedText | undefined {
  if (!text) return undefined;
  const out: LocalizedText = {};
  for (const [k, v] of Object.entries(text)) if (v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? out : undefined;
}

/** Number input → number or null. Empty means "no data", never zero. */
export function intOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function newId(): string {
  return crypto.randomUUID();
}
