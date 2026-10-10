'use client';

import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import type { TokenPair } from './types';

const STORAGE_KEY = 'alproutes.auth';
/** Refresh a little before expiry so a request never leaves with a dead token. */
const EXPIRY_MARGIN_MS = 30_000;

type Listener = (session: TokenPair | null) => void;

let session: TokenPair | null = null;
let loaded = false;
const listeners = new Set<Listener>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    session = raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    session = null;
  }
}

export function getSession(): TokenPair | null {
  load();
  return session;
}

export function setSession(next: TokenPair | null) {
  session = next;
  loaded = true;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); the session then lives in memory only.
  }
  listeners.forEach((l) => l(next));
}

export function onSessionChange(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Plain client without the auth middleware: used for refresh itself.
const bare = createClient<paths>({ baseUrl: '/api/v1' });

// The contract requires refresh to run single-flight: a reused refresh token revokes the chain.
let refreshing: Promise<TokenPair | null> | null = null;

function refresh(current: TokenPair): Promise<TokenPair | null> {
  refreshing ??= bare
    .POST('/auth/refresh', { body: { refreshToken: current.refreshToken } })
    .then(({ data }) => {
      setSession(data ?? null);
      return data ?? null;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function accessToken(): Promise<string | null> {
  let s = getSession();
  if (!s) return null;
  if (Date.parse(s.accessTokenExpiresAt) - Date.now() < EXPIRY_MARGIN_MS) {
    if (Date.parse(s.refreshTokenExpiresAt) <= Date.now()) {
      setSession(null);
      return null;
    }
    s = await refresh(s);
  }
  return s?.accessToken ?? null;
}

const auth: Middleware = {
  async onRequest({ request }) {
    const token = await accessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
};

/** Backend client for the browser, via the same-origin `/api/v1` proxy. */
export const api = createClient<paths>({ baseUrl: '/api/v1' });
api.use(auth);

export async function logout() {
  const s = getSession();
  setSession(null);
  if (s) await bare.POST('/auth/logout', { body: { refreshToken: s.refreshToken } }).catch(() => undefined);
}

export { bare as publicApi };
