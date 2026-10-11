'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { usePrefs } from '@/components/Prefs';
import { publicApi, setSession } from '@/lib/api/browser';
import type { TokenPair, UserRole } from '@/lib/api/types';

export type LoginConfig = {
  googleClientId: string | null;
  devLogin: boolean;
};

// Minimal typings of the Google Identity Services script.
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; nonce: string; ux_mode: 'popup'; auto_select: boolean }) => void;
  renderButton: (el: HTMLElement, o: Record<string, string | number>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const ROLES: UserRole[] = ['user', 'moderator', 'admin'];

/**
 * Sign-in: the provider gives the browser an ID token, the backend verifies it
 * (POST /auth/oauth/{provider}) and returns our own token pair. The nonce ties the ID token to
 * this page load, so a token captured elsewhere cannot be replayed here.
 */
export function LoginForm({ config }: { config: LoginConfig }) {
  const { t, lang, theme, session } = usePrefs();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nonce = useRef<string>('');
  if (!nonce.current && typeof crypto !== 'undefined') nonce.current = crypto.randomUUID();

  const done = useCallback((pair: TokenPair) => {
    setSession(pair);
    router.push('/');
  }, [router]);

  const exchange = useCallback(async (provider: 'google', idToken: string) => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await publicApi.POST('/auth/oauth/{provider}', {
      params: { path: { provider } },
      body: { idToken, nonce: nonce.current },
    });
    setBusy(false);
    if (data) done(data);
    else setError(problem?.detail ?? problem?.title ?? t('login.failed'));
  }, [done, t]);

  // ---------------------------------------------------------------- Google

  const googleRef = useRef<HTMLDivElement>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  useEffect(() => {
    const id = window.google?.accounts.id;
    if (!config.googleClientId || !id || !googleRef.current) return;
    id.initialize({
      client_id: config.googleClientId,
      callback: (r) => void exchange('google', r.credential),
      nonce: nonce.current,
      ux_mode: 'popup',
      auto_select: false,
    });
    googleRef.current.innerHTML = '';
    id.renderButton(googleRef.current, {
      type: 'standard',
      theme: theme === 'light' ? 'outline' : 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      locale: lang,
      width: 360,
    });
  }, [config.googleClientId, googleLoaded, exchange, lang, theme]);

  const providers = !!config.googleClientId;

  return (
    <div className="login">
      {config.googleClientId && (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGoogleLoaded(true)} />
      )}
      <div className="login-side">
        <div className="login-form">
          <h1 className="h1">{t('login.title')}</h1>
          {session && (
            <p className="status-note">
              {t('login.signedInAs')} {session.user.displayName} ({session.user.role})
            </p>
          )}

          {providers && (
            <div className="login-providers">
              {config.googleClientId && <div ref={googleRef} className="google-button" aria-busy={!googleLoaded} />}
              <p className="field-hint">{t('login.providersNote')}</p>
            </div>
          )}
          {!providers && !config.devLogin && <p className="status-note">{t('login.noProviders')}</p>}
          {busy && <p className="muted">{t('common.loading')}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}

          {config.devLogin && <DevLogin onDone={done} separated={providers} />}
        </div>
      </div>
    </div>
  );
}

/** Local development only: the backend's dev profile signs anyone in by email. */
function DevLogin({ onDone, separated }: { onDone: (p: TokenPair) => void; separated: boolean }) {
  const { t } = usePrefs();
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
    if (data) onDone(data);
    else if (response.status === 404) setError(t('login.devUnavailable'));
    else setError(problem?.detail ?? problem?.title ?? t('login.failed'));
  };

  return (
    <form className={`login-dev${separated ? ' separated' : ''}`} onSubmit={(e) => void submit(e)}>
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
  );
}
