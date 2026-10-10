'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import type { AreaSummary, Grade, GradeSystem, LocalizedText } from '@/lib/api/types';
import { areaTypeLabel, loc, locText } from '@/lib/i18n';
import { LANGS } from '@/lib/prefs';
import { usePrefs } from '../Prefs';

export function Field({ label, error, hint, children }: { label: string; error?: string[]; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error?.map((e) => <span key={e} className="field-error">{e}</span>)}
    </div>
  );
}

/** One input per language: catalogue texts carry all translations (contract LocalizedText). */
export function LocalizedInput({
  value, onChange, multiline, maxLength, required,
}: {
  value: LocalizedText | undefined;
  onChange: (v: LocalizedText) => void;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  const set = (lang: string, text: string) => onChange({ ...(value ?? {}), [lang]: text });
  return (
    <div className="l10n">
      {LANGS.map((l) => (
        <label key={l} className="l10n-row">
          <span className="mono">{l.toUpperCase()}</span>
          {multiline ? (
            <textarea className="editor" maxLength={maxLength} value={value?.[l] ?? ''} onChange={(e) => set(l, e.target.value)} />
          ) : (
            <input className="input" maxLength={maxLength} required={required && l === 'ru' && !value?.en} value={value?.[l] ?? ''}
              onChange={(e) => set(l, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

/** Area search by name; shows the chosen area with its type. */
export function AreaPicker({ value, onChange }: { value: AreaSummary | null; onChange: (a: AreaSummary | null) => void }) {
  const { t, lang } = usePrefs();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AreaSummary[]>([]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setFound([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void api.GET('/areas', { params: { query: { q: query, limit: 20 } }, signal: ctrl.signal }).then(({ data }) => setFound(data?.items ?? []));
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  if (value) {
    return (
      <div className="picked">
        <span className="eyebrow">{areaTypeLabel(value.type, lang)}</span>
        <b>{locText(value.name, lang)}</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>{t('ed.change')}</button>
      </div>
    );
  }
  return (
    <div className="picker">
      <input className="input" placeholder={t('ed.areaSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <ul className="picker-list">
          {found.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onChange(a)}>
                <span className="eyebrow">{areaTypeLabel(a.type, lang)}</span> {locText(a.name, lang)}
                {a.status !== 'published' && <span className="muted"> · {a.status}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

let gradeSystemsCache: Promise<GradeSystem[]> | null = null;

export function useGradeSystems(): GradeSystem[] {
  const [systems, setSystems] = useState<GradeSystem[]>([]);
  useEffect(() => {
    // The reference changes rarely (contract): fetch once per page load.
    gradeSystemsCache ??= api.GET('/grade-systems', { params: { query: { limit: 100 } } }).then(({ data }) => data?.items ?? []);
    void gradeSystemsCache.then(setSystems);
  }, []);
  return systems;
}

/**
 * Grades: at most one per system, values only from the reference (Cyrillic «5Б» in RU).
 * No conversion between systems is offered: each grade is entered in its own system.
 */
export function GradesEditor({ value, onChange, errors }: { value: Grade[]; onChange: (g: Grade[]) => void; errors: (i: number) => string[] }) {
  const { t, lang } = usePrefs();
  const systems = useGradeSystems();
  const free = systems.filter((s) => !value.some((g) => g.system === s.code));
  return (
    <div className="grades-editor">
      {value.length === 0 && <p className="muted">{t('route.noGrade')}</p>}
      {value.map((g, i) => {
        const sys = systems.find((s) => s.code === g.system);
        return (
          <div key={g.system} className="grade-row">
            <span className="grade-sys" title={sys ? loc(sys.name, lang)?.text : undefined}>{g.system}</span>
            <div className="cat-picker">
              {sys?.values.map((v) => (
                <button key={v.value} type="button" aria-pressed={g.value === v.value}
                  onClick={() => onChange(value.map((x, j) => (j === i ? { ...x, value: v.value } : x)))}>
                  {v.value}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('geo.delete')}</button>
            {errors(i).map((e) => <span key={e} className="field-error">{e}</span>)}
          </div>
        );
      })}
      {free.length > 0 && (
        <select className="theme-select" value="" onChange={(e) => {
          // No preselected value: a grade nobody chose must not slip into the catalogue.
          const s = systems.find((x) => x.code === e.target.value);
          if (s) onChange([...value, { system: s.code, value: '' }]);
        }}>
          <option value="" disabled>{t('ed.addGrade')}</option>
          {free.map((s) => <option key={s.code} value={s.code}>{s.code} — {loc(s.name, lang)?.text}</option>)}
        </select>
      )}
    </div>
  );
}

/** Shown instead of a form when nobody is signed in. */
export function SignInFirst() {
  const { t, session } = usePrefs();
  if (session === undefined) return <div className="page"><p className="muted">{t('common.loading')}</p></div>;
  return (
    <div className="page">
      <p className="status-note">{t('ed.signIn')}</p>
      <a className="btn btn-primary" href="/login" style={{ alignSelf: 'flex-start' }}>{t('header.signIn')}</a>
    </div>
  );
}
