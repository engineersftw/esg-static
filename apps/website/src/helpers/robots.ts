// Body of /robots.txt. Crawling is allowed only when PUBLIC_ALLOW_INDEXING is exactly "true"
// (set in the production build), so preview and staging deployments stay out of search engines.

export function robotsTxt(site: URL | string, allowIndexing: string | undefined): string {
  if (allowIndexing !== "true") return "User-agent: *\nDisallow: /\n";
  const sitemap = new URL("/sitemap-index.xml", site).href;
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /search\n\nSitemap: ${sitemap}\n`;
}
