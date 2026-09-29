import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useStore } from '../store';

export function LoginPage() {
  const { t, signIn } = useStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [tried, setTried] = useState(false);
  const [toast, showToast] = useToast();

  const errors = {
    name: mode === 'up' && !name.trim() ? t('login.err.name') : null,
    email: !/^\S+@\S+\.\S+$/.test(email) ? t('login.err.email') : null,
    password: password.length < 8 ? t('login.err.password') : null,
  };
  const valid = !errors.name && !errors.email && !errors.password;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) return;
    // No backend yet: the account lives in this browser only.
    signIn({ name: name.trim() || email.split('@')[0], email });
    navigate('/profile');
  };

  return (
    <div className="login">
      <section className="login-hero">
        <svg className="topo" viewBox="0 0 760 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g fill="none" strokeWidth="1" strokeOpacity="0.4" style={{ stroke: 'var(--blue)' }}>
            {[
              [470, 420, 34, 20, -24], [464, 428, 72, 46, -24], [456, 438, 116, 76, -22], [446, 450, 166, 110, -20],
              [434, 464, 222, 150, -18], [420, 480, 284, 194, -16], [404, 498, 352, 242, -14], [386, 518, 426, 296, -12],
            ].map(([cx, cy, rx, ry, rot], i) => (
              <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} 470 420)`} />
            ))}
          </g>
          <path d="M170 860 C230 760 300 700 340 620 S420 500 470 420" fill="none" strokeWidth="3" strokeLinecap="round" style={{ stroke: 'var(--accent)' }} />
          <circle cx="470" cy="420" r="9" style={{ fill: 'var(--accent)' }} />
        </svg>
        <div className="copy">
          <h1>{t('login.headline')}</h1>
          <p>{t('login.lead')}</p>
        </div>
      </section>

      <section className="login-side">
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="segmented" role="tablist" style={{ fontSize: '1.5rem' }}>
            <button type="button" role="tab" aria-pressed={mode === 'in'} aria-selected={mode === 'in'} onClick={() => setMode('in')} style={{ height: '4rem' }}>
              {t('login.signIn')}
            </button>
            <button type="button" role="tab" aria-pressed={mode === 'up'} aria-selected={mode === 'up'} onClick={() => setMode('up')} style={{ height: '4rem' }}>
              {t('login.signUp')}
            </button>
          </div>
          {mode === 'up' && (
            <label className="field" style={{ color: 'var(--text2)', fontSize: '1.4rem' }}>
              {t('login.name')}
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && !!errors.name} />
              {tried && errors.name && <span className="field-error">{errors.name}</span>}
            </label>
          )}
          <label className="field" style={{ color: 'var(--text2)', fontSize: '1.4rem' }}>
            {t('login.email')}
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={tried && !!errors.email}
            />
            {tried && errors.email && <span className="field-error">{errors.email}</span>}
          </label>
          <div className="field" style={{ color: 'var(--text2)', fontSize: '1.4rem' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label htmlFor="password">{t('login.password')}</label>
              {mode === 'in' && (
                <button type="button" className="linklike" style={{ fontSize: '1.3rem' }} onClick={() => showToast(t('login.forgotSoon'))}>
                  {t('login.forgot')}
                </button>
              )}
            </span>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={tried && !!errors.password}
            />
            {tried && errors.password && <span className="field-error">{errors.password}</span>}
          </div>
          <label className="check" style={{ color: 'var(--text2)' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: '1.8rem', height: '1.8rem' }} />
            {t('login.remember')}
          </label>
          <button type="submit" className="btn btn-primary">{t(mode === 'in' ? 'login.submitIn' : 'login.submitUp')}</button>
          <div className="divider">{t('login.or')}</div>
          <button type="button" className="btn btn-ghost" onClick={() => showToast(t('login.soon', { p: 'Google' }))}>{t('login.google')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => showToast(t('login.soon', { p: 'VK ID' }))}>{t('login.vk')}</button>
          <p className="muted" style={{ fontSize: '1.3rem', lineHeight: 1.5 }}>{t('login.note')}</p>
        </form>
      </section>
      {toast}
    </div>
  );
}
