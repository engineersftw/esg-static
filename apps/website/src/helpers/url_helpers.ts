export const toSlug = (str: string): string => {
  return str
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric characters except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Remove multiple consecutive hyphens
};

// The text shown for a profile link. The content stores full URLs (the schema checks them), so
// social links show their handle and the rest their host and path.
export const profileLinkLabel = (type: string, href: string): string => {
  const url = new URL(href);
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if ((type === "x" || type === "instagram" || type === "tiktok") && first) return `@${first.replace(/^@/, "")}`;
  return url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "");
};
