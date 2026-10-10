'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { usePrefs } from '@/components/Prefs';
import { publicApi, setSession } from '@/lib/api/browser';
import type { UserRole } from '@/lib/api/types';

const ROLES: UserRole[] = ['user', 'moderator', 'admin'];

export default function LoginPage() {
  const { t, session } = usePrefs();
  const router = useRouter();
  const [email, setEmail] = useState('mod@local');
  const [name, setName] = useState('Модератор');
  const [role, setRole] = useState<UserRole>('moderator');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: problem, response } = await publicApi.POST('/auth/dev-login', {
      body: { email, displayName: name || undefined, role },
    });
    setBusy(false);
    if (data) {
      setSession(data);
      router.push('/');
    } else if (response.status === 404) {
      setError(t('login.devUnavailable'));
    } else {
      setError(problem?.detail ?? problem?.title ?? t('login.failed'));
    }
  };

  return (
    <div className="login">
      <div className="login-side">
        <form className="login-form" onSubmit={(e) => void submit(e)}>
          <h1 className="h1">{t('login.title')}</h1>
          {session && (
            <p className="status-note">
              {t('login.signedInAs')} {session.user.displayName} ({session.user.role})
            </p>
          )}
          <p className="dev-box">{t('login.devNote')}</p>
          <label className="field">
            {t('login.email')}
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            {t('login.name')}
            <input className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            {t('login.role')}
            <div className="segmented" role="group">
              {ROLES.map((r) => (
                <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>
              ))}
            </div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('login.submit')}</button>
        </form>
      </div>
    </div>
  );
}
