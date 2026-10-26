// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: process.env.HOSTNAME ? process.env.HOSTNAME : "http://localhost:4321",
  integrations: [
    // The search page is a tool, not content.
    sitemap({ filter: (page) => new URL(page).pathname !== "/search/" }),
  ],
  // Old Rails URLs that point at an ID (/v/601, /o/111, /video/<name>--601, ...) are redirected by
  // the Pages Function in functions/_middleware.ts, not by pages, to stay under Cloudflare's file limit.
  redirects: {
    "/episodes": "/videos",
    // The list pages live at /<name>/list/<page>; the bare /list has no page of its own.
    "/conferences/list": "/conferences",
    "/organizations/list": "/organizations",
    "/presenters/list": "/presenters",
  },
});
