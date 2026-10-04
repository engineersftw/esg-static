export const toSlug = (str: string): string => {
  return str
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric characters except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Remove multiple consecutive hyphens
};

/**
 * Rails' `String#parameterize`, which built the name part of the old site's `<name>--<id>` URLs:
 * accents are transliterated, runs of anything but letters, digits, `-` and `_` become one `-`,
 * and the result is trimmed of `-` and lowercased.
 */
export const parameterize = (str: string): string => {
  return str
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // transliterate accented letters
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
};
