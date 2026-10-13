// /robots.txt is generated, because the Sitemap line must be an absolute URL built from `site`.
import type { APIContext } from "astro";
import { robotsTxt } from "../helpers/robots";

export function GET(context: APIContext) {
  return new Response(robotsTxt(context.site!, import.meta.env.PUBLIC_ALLOW_INDEXING), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
