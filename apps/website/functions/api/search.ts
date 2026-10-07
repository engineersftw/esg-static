/**
 * Cloudflare Pages Function: video keyword search, `GET /api/search?q=<words>&page=<n>`, for the
 * /search page (src/pages/search.astro).
 *
 * The index is dist/search-index.json (src/pages/search-index.json.ts), bundled in when wrangler
 * builds this function, so build the site before `wrangler pages deploy`/`dev`. The matching and
 * ranking are in src/helpers/search.ts, which has the tests. Each request counts against the
 * Workers request quota, so the /search page waits for a pause in typing before it calls this.
 */
import index from '../../dist/search-index.json';
import { createSearch, type SearchEntry } from '../../src/helpers/search';

// Built once per Worker instance, not per request: it normalizes the text of every video.
const search = createSearch(index as SearchEntry[]);

interface Context {
  request: Request;
}

export const onRequestGet = async ({ request }: Context): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const body = search(params.get('q') ?? '', Number(params.get('page') ?? 1));
  return Response.json(body, {
    // Results only change with a deploy, so a browser may reuse them for a while.
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
};
