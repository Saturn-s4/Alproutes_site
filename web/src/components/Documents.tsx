'use client';

import { useState } from 'react';
import type { Document } from '@/lib/api/types';
import { loc, rightsLabel, sourceTypeLabel } from '@/lib/i18n';
import { usePrefs } from './Prefs';

/**
 * Archival PDFs. The public only gets documents with a cleared rights status (the API filters).
 * The browser's own PDF viewer shows the file: the download endpoint redirects to a short-lived link.
 */
export function Documents({ documents }: { documents: Document[] }) {
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState<string | null>(null);
  if (documents.length === 0) return <p className="muted">{t('doc.none')}</p>;
  return (
    <div className="docs">
      {documents.map((d) => {
        const href = `/api/v1/documents/${d.id}/download`;
        const title = loc(d.title, lang)?.text;
        const meta = [
          sourceTypeLabel(d.sourceType, lang),
          d.year != null ? String(d.year) : null,
          d.pageCount != null ? `${d.pageCount} ${t('doc.pages')}` : null,
          rightsLabel(d.rightsStatus, lang),
        ].filter(Boolean);
        return (
          <div key={d.id} className="doc">
            <div className="pdf-row">
              <span className="pdf-icon">PDF</span>
              <span className="t">
                <span>{title}</span>
                <span>{meta.join(' · ')}</span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-blue"
                aria-expanded={open === d.id}
                onClick={() => setOpen(open === d.id ? null : d.id)}
              >
                {open === d.id ? t('doc.close') : t('doc.open')}
              </button>
              <a className="btn btn-sm btn-ghost" href={href} target="_blank" rel="noreferrer">
                {t('doc.download')}
              </a>
            </div>
            <p className="doc-source">
              {t('doc.source')}: {d.sourceDescription}
              {d.rightsNote ? ` · ${d.rightsNote}` : null}
            </p>
            {open === d.id && <iframe className="pdf-frame" src={href} title={title} />}
          </div>
        );
      })}
    </div>
  );
}
