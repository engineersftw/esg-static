// Body of /llms.txt, the Markdown summary of the site for AI tools (https://llmstxt.org). Every
// link is absolute, built from `site`, and points at pages that exist: the lists, the feed and
// the search.
import { SITE_DESCRIPTION, SITE_TITLE } from "../consts";

export function llmsTxt(site: URL | string): string {
  const url = (path: string) => new URL(path, site).href;
  const origin = url("/").replace(/\/$/, ""); // patterns keep their <slug> placeholder, which URL would encode
  return `# ${SITE_TITLE}

> ${SITE_DESCRIPTION}

Every video, conference, presenter and organization has its own page. Descriptions are plain text.

## Browse

- [Videos](${url("/videos")}): every recorded talk, newest first
- [Conferences](${url("/conferences")}): conferences, each with its videos and tracks
- [Organizations](${url("/organizations")}): the tech communities behind the events
- [Presenters](${url("/presenters")}): the speakers, each with their talks
- [Search](${url("/search")}): search videos by title, presenter, organization, playlist or description
- [RSS feed](${url("/feed")}): the 50 newest videos

## URLs

- Video: ${origin}/video/<slug>
- Conference or playlist: ${origin}/conference/<slug> or ${origin}/playlist/<slug>
- Organization: ${origin}/organization/<slug>
- Presenter: ${origin}/presenter/<slug>
- Sitemap: ${url("/sitemap-index.xml")}
`;
}
