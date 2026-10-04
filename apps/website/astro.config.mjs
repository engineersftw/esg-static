// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: process.env.HOSTNAME ? process.env.HOSTNAME : "http://localhost:4321",
  integrations: [mdx(), sitemap()],
  // Old Rails URLs that point at an ID (/v/601, /o/111, /video/<name>--601, ...) are redirected by
  // the Pages Function in functions/_middleware.ts, not by pages, to stay under Cloudflare's file limit.
  redirects: {
    "/episodes": "/videos",
  },
});
