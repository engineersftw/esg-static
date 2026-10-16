// /llms.txt is generated, because its links must be absolute URLs built from `site`.
import type { APIContext } from "astro";
import { llmsTxt } from "../helpers/llms";

export function GET(context: APIContext) {
  return new Response(llmsTxt(context.site!), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
