import { LoginForm, type LoginConfig } from './LoginForm';

// Without this the page would be prerendered at build time and the environment frozen into it.
export const dynamic = 'force-dynamic';

/**
 * Provider settings are read per request on the server, not baked in at build time:
 * the same build runs locally and in production with different client ids.
 */
export default function LoginPage() {
  const config: LoginConfig = {
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    // The dev form only works against a backend in the dev profile; hidden in production builds unless asked for.
    devLogin: process.env.DEV_LOGIN ? process.env.DEV_LOGIN === 'true' : process.env.NODE_ENV !== 'production',
  };
  return <LoginForm config={config} />;
}
