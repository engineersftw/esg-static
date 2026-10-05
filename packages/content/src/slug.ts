/** URL slugs for content entries, generated the same way as pg-export's. */

export function slugify(title: string, fallback = "playlist"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Slugs unique within a collection: existing ones are reserved, collisions get -2, -3, … */
export function slugAllocator(existing: string[]) {
  const used = new Set(existing);
  return (text: string, fallback: string) => {
    const base = slugify(text, fallback);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}
