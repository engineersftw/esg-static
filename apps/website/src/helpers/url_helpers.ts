export const toSlug = (str: string): string => {
  return str
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric characters except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Remove multiple consecutive hyphens
};

// The twitter field holds a handle, but older entries have "@handle" or a full twitter.com URL.
export const twitterLink = (value: string | null | undefined): { href: string; label: string } | null => {
  const handle = value?.trim().replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  return { href: `https://x.com/${handle}`, label: `@${handle}` };
};

// A website URL, labelled with its host and path. Some old entries lack
// the scheme ("encore.dev") or hold text that isn't a URL; the latter gets no link.
export const websiteLink = (value: string | null | undefined): { href: string; label: string } | null => {
  const raw = value?.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) return null;
    const host = url.hostname.replace(/^www\./, "");
    return { href: url.href, label: host + url.pathname.replace(/\/$/, "") };
  } catch {
    return null;
  }
};
