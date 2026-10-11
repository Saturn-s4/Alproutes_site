'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { usePrefs } from '@/components/Prefs';
import { publicApi, setSession } from '@/lib/api/browser';
import type { TokenPair, UserRole } from '@/lib/api/types';

export type LoginConfig = {
  googleClientId: string | null;
  apple: { clientId: string; redirectUri: string } | null;
  devLogin: boolean;
};

// Minimal typings of the two provider scripts (Google Identity Services, Sign in with Apple JS).
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; nonce: string; ux_mode: 'popup'; auto_select: boolean }) => void;
  renderButton: (el: HTMLElement, o: Record<string, string | number>) => void;
};
type AppleSignInResult = {
  authorization: { id_token: string };
  user?: { name?: { firstName?: string; lastName?: string } };
};
type AppleAuth = {
  init: (o: { clientId: string; scope: string; redirectURI: string; state: string; nonce: string; usePopup: boolean }) => void;
  signIn: () => Promise<AppleSignInResult>;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
    AppleID?: { auth: AppleAuth };
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

  const exchange = useCallback(async (provider: 'google' | 'apple', idToken: string, displayName?: string) => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await publicApi.POST('/auth/oauth/{provider}', {
      params: { path: { provider } },
      body: { idToken, nonce: nonce.current, displayName },
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

  // ---------------------------------------------------------------- Apple

  const [appleLoaded, setAppleLoaded] = useState(false);
  useEffect(() => {
    if (!config.apple || !appleLoaded || !window.AppleID) return;
    window.AppleID.auth.init({
      clientId: config.apple.clientId,
      scope: 'name email',
      redirectURI: config.apple.redirectUri,
      state: nonce.current,
      nonce: nonce.current,
      usePopup: true,
    });
  }, [config.apple, appleLoaded]);

  const appleSignIn = async () => {
    if (!window.AppleID) return;
    setError(null);
    try {
      const res = await window.AppleID.auth.signIn();
      // Apple sends the name on the first sign-in only, and outside the ID token.
      const name = [res.user?.name?.firstName, res.user?.name?.lastName].filter(Boolean).join(' ') || undefined;
      await exchange('apple', res.authorization.id_token, name);
    } catch (e) {
      // Closing the popup is not an error worth showing.
      const code = (e as { error?: string } | null)?.error;
      if (code !== 'popup_closed_by_user' && code !== 'user_cancelled_authorize') setError(t('login.failed'));
    }
  };

  const providers = !!config.googleClientId || !!config.apple;

  return (
    <div className="login">
      {config.googleClientId && (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGoogleLoaded(true)} />
      )}
      {config.apple && (
        <Script
          src={`https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/${lang === 'ru' ? 'ru_RU' : 'en_US'}/appleid.auth.js`}
          strategy="afterInteractive"
          onReady={() => setAppleLoaded(true)}
        />
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
              {config.apple && (
                <button type="button" className="btn apple-button" disabled={!appleLoaded || busy} onClick={() => void appleSignIn()}>
                  <svg viewBox="0 0 17 20" width="17" height="20" aria-hidden="true">
                    <path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1.1-3.1-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.6z" />
                  </svg>
                  {t('login.apple')}
                </button>
              )}
              <p className="field-hint">{t('login.providersNote')}</p>
            </div>
          )}
          {!providers && !config.devLogin && <p className="status-note">{t('login.noProviders')}</p>}
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
