import createClient from 'openapi-fetch';
import type { paths } from './schema';

/** Backend client for server components. Public catalogue reads only: no user token here. */
export const serverApi = createClient<paths>({
  baseUrl: process.env.API_URL ?? 'http://localhost:8080/api/v1',
  // Catalogue pages must reflect moderation decisions right away; caching comes later.
  cache: 'no-store',
});
