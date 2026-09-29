import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CloseIcon, UploadIcon } from '../components/Icons';
import { RouteMap } from '../components/RouteMap';
import { DEMO_ROUTES, CATEGORIES, loc, type Category, type Character, type Loc, type Route, type Season, type Visibility } from '../data/routes';
import { parseTrackFile, trackStats, type TrackPoint } from '../lib/geo';
import { useStore } from '../store';

interface Draft {
  peak: string;
  name: string;
  region: string;
  category: Category;
  seasons: Season[];
  character: Character;
  track: TrackPoint[] | null;
  trackFile: { name: string; size: number } | null;
  description: string;
  pdfs: { name: string; year: string }[];
  visibility: Visibility;
}

const EMPTY: Draft = {
  peak: '',
  name: '',
  region: DEMO_ROUTES[0].region.ru,
  category: '2А',
  seasons: ['summer'],
  character: 'combined',
  track: null,
  trackFile: null,
  description: '',
  pdfs: [],
  visibility: 'public',
};

const DRAFT_KEY = 'alproutes.uploadDraft';
const fmtSize = (b: number, lang: 'ru' | 'en') =>
  b > 1e6 ? `${(b / 1e6).toFixed(1).replace('.', lang === 'ru' ? ',' : '.')} ${lang === 'ru' ? 'МБ' : 'MB'}` : `${Math.max(1, Math.round(b / 1e3))} ${lang === 'ru' ? 'КБ' : 'KB'}`;

function fromRoute(r: Route): Draft {
  return {
    peak: r.peak.ru,
    name: r.name.ru,
    region: r.region.ru,
    category: r.category,
    seasons: r.seasons,
    character: r.character,
    track: r.track,
    trackFile: r.track ? { name: `${r.id}.gpx`, size: r.track.length * 60 } : null,
    description: r.description.map((d) => d.ru).join('\n\n'),
    pdfs: r.pdfs.map((p) => ({ name: p.title.ru, year: String(p.year) })),
    visibility: r.own?.visibility ?? 'public',
  };
}

export function UploadPage() {
  const { t, lang, settings, fmtHeight, fmtLength, saveRoute, ownRoutes } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = ownRoutes.find((r) => r.id === params.get('edit'));

  const [d, setD] = useState<Draft>(() => {
    if (editing) return fromRoute(editing);
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) return { ...EMPTY, ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return EMPTY;
  });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [photos, setPhotos] = useState<{ url: string; name: string }[]>([]);
  const [trackError, setTrackError] = useState(false);
  const [over, setOver] = useState(false);
  const [tried, setTried] = useState(false);
  const trackInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // Autosave the draft (without photos) a moment after each change.
  useEffect(() => {
    if (editing) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
        setSavedAt(new Date());
      } catch {
        /* quota exceeded or storage disabled */
      }
    }, 600);
    return () => clearTimeout(id);
  }, [d, editing]);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => (d.track ? trackStats(d.track) : null), [d.track]);
  const regions = useMemo(() => {
    const seen = new Map<string, Loc>();
    DEMO_ROUTES.forEach((r) => seen.set(r.region.ru, r.region));
    return [...seen.entries()];
  }, []);
  const regionLoc = regions.find(([ru]) => ru === d.region)?.[1] ?? { ru: d.region, en: d.region };
  const areaLoc = DEMO_ROUTES.find((r) => r.region.ru === d.region)?.area ?? { ru: '', en: '' };

  const loadTrack = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pts = parseTrackFile(await file.text());
      set({ track: pts, trackFile: { name: file.name, size: file.size } });
      setTrackError(false);
    } catch {
      setTrackError(true);
    }
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 40 - photos.length)
      .map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    setPhotos((p) => [...p, ...next]);
  };

  const wrap = (before: string, after = '', linePrefix = false) => {
    const el = editor.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    let next: string;
    let cursor: number;
    if (linePrefix) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      next = value.slice(0, lineStart) + before + value.slice(lineStart);
      cursor = e + before.length;
    } else {
      next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
      cursor = e + before.length;
    }
    set({ description: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const checks = [
    { t: t('upload.basics'), ok: !!(d.peak.trim() && d.name.trim()), s: d.peak.trim() && d.name.trim() ? t('upload.ready') : t('upload.empty') },
    { t: t('upload.track'), ok: !!d.track, s: d.track ? t('upload.files', { n: 1 }) : t('upload.empty') },
    { t: t('upload.photos'), ok: photos.length > 0, s: photos.length ? String(photos.length) : t('upload.empty') },
    { t: t('upload.description'), ok: !!d.description.trim(), s: d.description.trim() ? t('upload.ready') : t('upload.empty') },
    { t: t('upload.pdf'), ok: true, s: d.pdfs.length ? t('upload.files', { n: d.pdfs.length }) : t('upload.optional') },
  ];
  const progress = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const canPublish = checks[0].ok && checks[1].ok;

  const build = (draft: boolean): Route => {
    const summit = stats?.summit;
    const both = (s: string): Loc => ({ ru: s, en: s });
    const paragraphs = d.description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      id: editing?.id ?? `route-${Date.now().toString(36)}`,
      peak: both(d.peak.trim()),
      name: both(d.name.trim()),
      region: regionLoc,
      area: areaLoc,
      category: d.category,
      height: stats?.maxM ?? 0,
      seasons: d.seasons,
      character: d.character,
      time: both('—'),
      summit: summit ? [summit[0], summit[1]] : [43.35, 42.44],
      track: d.track,
      tracksCount: d.track ? 1 : 0,
      photos: photos.length,
      reviewsCount: 0,
      pdfs: d.pdfs.map((p) => ({ title: both(p.name), year: Number(p.year) || new Date().getFullYear(), meta: both('PDF') })),
      legs: stats ? [{ name: { ru: 'Старт', en: 'Start' }, h: stats.startM }, { name: { ru: 'Вершина', en: 'Summit' }, h: stats.maxM }] : [],
      description: paragraphs.length ? paragraphs.map(both) : [both('')],
      own: { visibility: d.visibility, draft, updated: new Date().toISOString() },
    };
  };

  const finish = (draft: boolean) => {
    setTried(true);
    if (!draft && !canPublish) return;
    if (draft && !d.peak.trim()) return;
    const r = build(draft);
    saveRoute(r);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    navigate(`/route/${r.id}`);
  };

  const pill = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className="chip chip-lg" aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
  const unit = t(settings.units === 'ft' ? 'unit.ft' : 'unit.m');

  return (
    <div className="page">
      <div className="upload">
        <div className="upload-main">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.6rem', flexWrap: 'wrap' }}>
            <h1 className="h1" style={{ fontSize: '3rem' }}>{editing ? loc(editing.peak, lang) : t('upload.title')}</h1>
            <span className="muted">
              {savedAt ? t('upload.saved', { t: savedAt.toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) }) : editing ? '' : t('upload.notSaved')}
            </span>
          </div>

          <section className="form-section">
            <h2 className="h2" style={{ fontSize: '1.7rem' }}><span className="section-num">01</span>{t('upload.basics')}</h2>
            <div className="grid3">
              <label className="field">
                {t('upload.peak')}
                <input className="input" value={d.peak} onChange={(e) => set({ peak: e.target.value })} aria-invalid={tried && !d.peak.trim()} />
              </label>
              <label className="field">
                {t('upload.routeName')}
                <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={tried && !d.name.trim()} />
              </label>
              <label className="field">
                {t('upload.region')}
                <select className="input" value={d.region} onChange={(e) => set({ region: e.target.value })}>
                  {regions.map(([ru, l]) => (
                    <option key={ru} value={ru}>
                      {loc(DEMO_ROUTES.find((r) => r.region.ru === ru)!.area, lang)} · {loc(l, lang)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="group">
              <span className="label">{t('upload.category')}</span>
              <div className="cat-picker" role="group" aria-label={t('upload.category')}>
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" aria-pressed={d.category === c} onClick={() => set({ category: c })}>{c}</button>
                ))}
              </div>
            </div>
            <div className="row-gap">
              <div className="group">
                <span className="label">{t('upload.season')}</span>
                <div className="chips">
                  {(['spring', 'summer', 'autumn', 'winter'] as const).map((s) =>
                    pill(d.seasons.includes(s), t(`season.${s}`), () =>
                      set({ seasons: d.seasons.includes(s) ? d.seasons.filter((x) => x !== s) : [...d.seasons, s] }),
                    ),
                  )}
                </div>
              </div>
              <div className="group">
                <span className="label">{t('upload.character')}</span>
                <div className="chips">
                  {(['rock', 'snowice', 'combined'] as const).map((c) => {
                    const label = t(`char.${c}`);
                    return pill(d.character === c, label[0].toUpperCase() + label.slice(1), () => set({ character: c }));
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2 className="h2" style={{ fontSize: '1.7rem' }}><span className="section-num">02</span>{t('upload.track')}</h2>
            <div className="track-cols">
              <div className="left">
                <div
                  className={'dropzone' + (over ? ' over' : '')}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); loadTrack(e.dataTransfer.files[0]); }}
                >
                  <UploadIcon />
                  <span>
                    {t('upload.drop')}{' '}
                    <button type="button" className="linklike" onClick={() => trackInput.current?.click()}>{t('upload.choose')}</button>
                  </span>
                  <input ref={trackInput} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml" hidden onChange={(e) => { loadTrack(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                {trackError && <span className="field-error" role="alert">{t('upload.badTrack')}</span>}
                {d.trackFile && d.track && (
                  <div className="file-row">
                    <span className="ok">✓</span>
                    <span className="t">
                      <span>{d.trackFile.name}</span>
                      <span>{t('upload.points', { size: fmtSize(d.trackFile.size, lang), n: d.track.length.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB') })}</span>
                    </span>
                    <button type="button" className="btn btn-sm" style={{ color: 'var(--muted)' }} onClick={() => trackInput.current?.click()}>{t('upload.replace')}</button>
                  </div>
                )}
                <div className="stats two">
                  <div><div className="k">{t('route.length')}</div><div className="v">{stats ? fmtLength(stats.lengthKm) : '—'}</div></div>
                  <div><div className="k">{t('route.gain')}</div><div className="v">{stats ? `+${fmtHeight(stats.gainM)} ${unit}` : '—'}</div></div>
                  <div><div className="k">{t('route.start')}</div><div className="v">{stats ? `${fmtHeight(stats.startM)} ${unit}` : '—'}</div></div>
                  <div><div className="k">{t('upload.max')}</div><div className="v">{stats ? `${fmtHeight(stats.maxM)} ${unit}` : '—'}</div></div>
                </div>
                <span className="muted" style={{ fontSize: '1.2rem' }}>{t('upload.computed')}</span>
              </div>
              <div className="preview-map">
                {d.track ? (
                  <>
                    <RouteMap routes={[]} layer={settings.layer} track={d.track} fitKey={d.track} />
                    <div className="map-overlay map-note">{t('upload.preview')}</div>
                  </>
                ) : (
                  <div className="empty-note">{t('upload.previewEmpty')}</div>
                )}
              </div>
            </div>
          </section>

          <section className="form-section">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.2rem', flexWrap: 'wrap' }}>
              <h2 className="h2" style={{ fontSize: '1.7rem' }}><span className="section-num">03</span>{t('upload.photos')}</h2>
              <span className="muted" style={{ fontSize: '1.3rem' }}>{t('upload.photosHint', { n: photos.length })}</span>
            </div>
            <div className="photo-grid">
              {photos.map((p, i) => (
                <div key={p.url} className={'photo-tile' + (i === 0 ? ' cover' : '')} style={{ backgroundImage: `url(${p.url})` }} role="img" aria-label={p.name}>
                  {i === 0 && <span className="tag">{t('upload.cover')}</span>}
                  <button
                    type="button"
                    className="remove"
                    aria-label={t('upload.removePhoto')}
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPhotos((list) => list.filter((x) => x !== p));
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              {photos.length < 40 && (
                <button type="button" className="photo-add" onClick={() => photoInput.current?.click()}>{t('upload.addPhoto')}</button>
              )}
              <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            </div>
          </section>

          <section className="form-section">
            <div className="desc-cols">
              <div className="left">
                <h2 className="h2" style={{ fontSize: '1.7rem' }}><span className="section-num">04</span>{t('upload.description')}</h2>
                <div>
                  <div className="editor-bar">
                    <button type="button" aria-label={t('upload.bold')} style={{ fontWeight: 700 }} onClick={() => wrap('**', '**')}>{lang === 'ru' ? 'Ж' : 'B'}</button>
                    <button type="button" aria-label={t('upload.italic')} style={{ fontStyle: 'italic' }} onClick={() => wrap('*', '*')}>{lang === 'ru' ? 'К' : 'I'}</button>
                    <button type="button" onClick={() => wrap('## ', '', true)}>{t('upload.heading')}</button>
                    <button type="button" onClick={() => wrap('- ', '', true)}>{t('upload.list')}</button>
                    <button type="button" onClick={() => wrap(lang === 'ru' ? '[Участок: ' : '[Section: ', ']')}>{t('upload.legMark')}</button>
                  </div>
                  <label className="sr-only" htmlFor="desc">{t('upload.description')}</label>
                  <textarea id="desc" ref={editor} className="editor" placeholder={t('upload.descPlaceholder')} value={d.description} onChange={(e) => set({ description: e.target.value })} />
                </div>
              </div>
              <div className="right">
                <h2 className="h2" style={{ fontSize: '1.7rem' }}><span className="section-num">05</span>{t('upload.pdf')}</h2>
                {d.pdfs.map((p, i) => (
                  <div className="pdf-edit" key={i}>
                    <span className="pdf-icon" style={{ width: '3rem', height: '3.6rem', fontSize: '0.9rem' }}>PDF</span>
                    <span className="t">{p.name}</span>
                    <input
                      aria-label={t('upload.year')}
                      inputMode="numeric"
                      value={p.year}
                      onChange={(e) => set({ pdfs: d.pdfs.map((x, j) => (j === i ? { ...x, year: e.target.value.replace(/\D/g, '').slice(0, 4) } : x)) })}
                    />
                    <button type="button" className="icon-btn" style={{ width: '3.2rem', height: '3.2rem' }} aria-label={t('upload.removePdf')} onClick={() => set({ pdfs: d.pdfs.filter((_, j) => j !== i) })}>
                      <CloseIcon />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn" style={{ border: '1.5px dashed var(--line2)', color: 'var(--blue-text)' }} onClick={() => pdfInput.current?.click()}>
                  {t('upload.attachPdf')}
                </button>
                <input
                  ref={pdfInput}
                  type="file"
                  accept="application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    set({ pdfs: [...d.pdfs, ...files.map((f) => ({ name: f.name.replace(/\.pdf$/i, ''), year: (f.name.match(/(19|20)\d\d/) || [''])[0] }))] });
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </section>
        </div>

        <aside className="upload-aside" style={{ paddingTop: '5.2rem' }}>
          <div className="box" style={{ padding: '2rem', gap: '1.6rem' }}>
            <div className="display" style={{ fontWeight: 500, fontSize: '1.6rem' }}>{t('upload.readiness')}</div>
            <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress}%` }} />
            </div>
            {checks.map((c) => (
              <div className="check-row" key={c.t}>
                <span className={'dot' + (c.ok ? ' ok' : '')}>{c.ok ? '✓' : ''}</span>
                <span className="t">{c.t}</span>
                <span className="s">{c.s}</span>
              </div>
            ))}
          </div>
          <fieldset className="box" style={{ padding: '2rem', margin: 0 }}>
            <legend className="sr-only">{t('upload.visibility')}</legend>
            <div className="muted" style={{ fontSize: '1.3rem' }}>{t('upload.visibility')}</div>
            {(['public', 'link', 'private'] as const).map((v) => (
              <label className="radio" key={v}>
                <input type="radio" name="vis" checked={d.visibility === v} onChange={() => set({ visibility: v })} />
                {t(`upload.vis.${v}`)}
              </label>
            ))}
          </fieldset>
          {tried && !canPublish && <span className="field-error" role="alert">{t('upload.needBasics')}</span>}
          <button type="button" className="btn btn-primary" style={{ height: '5rem', fontSize: '1.6rem' }} onClick={() => finish(false)}>
            {t('upload.publish')}
          </button>
          <button type="button" className="btn btn-ghost" style={{ height: '4.6rem', fontSize: '1.5rem', color: 'var(--text)' }} onClick={() => finish(true)}>
            {t('upload.saveDraft')}
          </button>
        </aside>
      </div>
    </div>
  );
}
