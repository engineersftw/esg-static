/**
 * Presenter and organization links (`links` in the frontmatter): turning what people type, or what
 * the old data holds, into the full URL the content stores.
 */
import type { ProfileLink, ProfileLinkType } from "@esg/db-types/content";

/** Every link type, in the order a new entry's links are written. */
export const PROFILE_LINK_TYPES: readonly ProfileLinkType[] = ["x", "website", "linkedin", "instagram", "tiktok"];

// Handle rules of each network, and the URL a handle becomes.
const HANDLES = {
  x: { hosts: ["x.com", "twitter.com"], pattern: /^[A-Za-z0-9_]{1,15}$/, url: (h: string) => `https://x.com/${h}` },
  instagram: { hosts: ["instagram.com"], pattern: /^[A-Za-z0-9._]{1,30}$/, url: (h: string) => `https://www.instagram.com/${h}/` },
  tiktok: { hosts: ["tiktok.com"], pattern: /^[A-Za-z0-9._]{2,24}$/, url: (h: string) => `https://www.tiktok.com/@${h}` },
} as const;

/**
 * Parse a URL that may lack its scheme ("encore.dev") or carry a typo from the old data
 * ("http//site", "http://http://site"). Null if it isn't a URL with a dotted host.
 */
function parseUrl(raw: string): { url: URL; text: string } | null {
  let text = raw
    .replace(/^(https?:\/\/)+(https?:\/\/)/i, "$2")
    .replace(/^(https?)\/\//i, "$1://");
  if (/\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    // `text` keeps the URL as written: URL.href would add a slash to a bare domain.
    return url.hostname.includes(".") ? { url, text } : null;
  } catch {
    return null;
  }
}

const hostIs = (url: URL, hosts: readonly string[]) => {
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
};

/**
 * The URL to store for a link of `type`, or null if `value` can't be one. X, Instagram and TikTok
 * take a handle (with or without "@") or a profile URL; a website or LinkedIn link takes a URL,
 * with or without the scheme.
 */
export function normalizeProfileLink(type: ProfileLinkType, value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  if (type === "website" || type === "linkedin") {
    const parsed = parseUrl(raw);
    if (!parsed || (type === "linkedin") !== hostIs(parsed.url, ["linkedin.com"])) return null;
    return parsed.text;
  }

  const rule = HANDLES[type];
  let handle = raw;
  // Instagram and TikTok handles can contain dots, so only a slash or the network's own host marks a URL.
  const bare = raw.toLowerCase().replace(/^www\./, "");
  if (raw.includes("/") || rule.hosts.some((h) => bare.startsWith(h))) {
    const parsed = parseUrl(raw);
    if (!parsed || !hostIs(parsed.url, rule.hosts)) return null;
    handle = parsed.url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  handle = handle.replace(/^@/, "");
  return rule.pattern.test(handle) ? rule.url(handle) : null;
}

/**
 * A link of any type, worked out from the value alone: a URL is an X, Instagram, TikTok or LinkedIn
 * link if it is on that network's host and a website otherwise, and an "@handle" is an X handle.
 * Null if it is neither.
 */
export function detectProfileLink(value: string | null | undefined): ProfileLink | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("@")) {
    const url = normalizeProfileLink("x", raw);
    return url ? { type: "x", url } : null;
  }
  const parsed = parseUrl(raw);
  if (!parsed) return null;
  const type: ProfileLinkType =
    (Object.keys(HANDLES) as (keyof typeof HANDLES)[]).find((t) => hostIs(parsed.url, HANDLES[t].hosts)) ??
    (hostIs(parsed.url, ["linkedin.com"]) ? "linkedin" : "website");
  const url = normalizeProfileLink(type, raw);
  return url ? { type, url } : null;
}

/** Links of the given types, normalized, in `PROFILE_LINK_TYPES` order; blank values are skipped. */
export function profileLinks(values: Partial<Record<ProfileLinkType, string | null | undefined>>): ProfileLink[] {
  const links: ProfileLink[] = [];
  for (const type of PROFILE_LINK_TYPES) {
    const value = values[type];
    if (!value?.trim()) continue;
    const url = normalizeProfileLink(type, value);
    if (!url) throw new Error(`"${value}" is not a valid ${type} link`);
    links.push({ type, url });
  }
  return links;
}
