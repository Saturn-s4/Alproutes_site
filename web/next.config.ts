import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';

const config: NextConfig = {
  // The browser talks to the backend through this same-origin proxy: no CORS, and the
  // backend address stays a server-side setting.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default config;
