/**
 * Cloudflare Pages Function: redirects the old Rails app's ID-based URLs to the new slug URLs.
 *
 * These used to be ~21k static redirect pages, which pushed the site past Cloudflare Pages' 20k
 * file limit. Here, one function handles them all, and the `<name>--<id>` forms accept any name
 * (only the ID matters, as in Rails), so links made before a rename still work.
 *
 * The ID → slug map is dist/legacy-redirects.json (src/pages/legacy-redirects.json.ts), bundled in
 * when wrangler builds this function, so build the site before `wrangler pages deploy`/`dev`.
 * Anything that doesn't match, or names an unknown or inactive ID, falls through to the static
 * site. public/_routes.json keeps the function off paths that can never match.
 */
import slugs from '../dist/legacy-redirects.json';

type Collection = keyof typeof slugs;

interface Context {
  request: Request;
  next: () => Promise<Response>;
}

/** Old path → [collection, captured ID or slug]. First match wins. */
const RULES: [RegExp, Collection | 'organization-slug'][] = [
  [/^\/v\/(\d+)\/?$/, 'video'], // /v/601
  [/^\/(\d+)\/?$/, 'video'], // /601
  [/^\/episodes\/(\d+)\/?$/, 'video'], // /episodes/601
  [/^\/video\/.+--(\d+)\/?$/, 'video'], // /video/<title>--601
  [/^\/organizations?\/(\d+)\/?$/, 'organization'], // /organization/111, /organizations/111
  [/^\/org\/(\d+)\/?$/, 'organization'], // /org/111
  [/^\/o\/(\d+)\/?$/, 'organization'], // /o/111
  [/^\/organization\/.+--(\d+)\/?$/, 'organization'], // /organization/<name>--111
  [/^\/organizations\/([^/]+)\/?$/, 'organization-slug'], // /organizations/<slug>
  [/^\/presenters?\/(\d+)\/?$/, 'presenter'], // /presenter/7, /presenters/7
  [/^\/s\/(\d+)\/?$/, 'presenter'], // /s/7
  [/^\/presenter\/.+--(\d+)\/?$/, 'presenter'], // /presenter/<name>--7
];

const knownSlugs = {
  organization: new Set(Object.values(slugs.organization)),
};

function target(pathname: string): string | null {
  for (const [pattern, collection] of RULES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    if (collection === 'organization-slug') {
      return knownSlugs.organization.has(match[1]) ? `/organization/${match[1]}` : null;
    }
    const slug = (slugs[collection] as Record<string, string>)[match[1]];
    return slug ? `/${collection}/${slug}` : null;
  }
  return null;
}

export const onRequest = async ({ request, next }: Context): Promise<Response> => {
  const url = new URL(request.url);
  const location = target(decodeURIComponent(url.pathname));
  if (!location) return next();
  return Response.redirect(new URL(location + url.search, url), 301);
};
