// A video's length, as the YouTube API reports it: an ISO 8601 duration such as `PT27M13S`, which is
// also what schema.org's VideoObject.duration takes. It is stored in the video's frontmatter as
// `duration`, right after `publishedAt`.

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * The duration if it is a real length, else null. YouTube sends `P0D` for a live stream or premiere
 * that has not happened yet, and nothing for a video it won't describe, so a zero or malformed value
 * is not stored.
 */
export function normalizeDuration(value: string | null | undefined): string | null {
  const text = value?.trim().toUpperCase();
  const m = text ? ISO_DURATION.exec(text) : null;
  if (!text || !m || m.slice(1).every((part) => !part || Number(part) === 0)) return null;
  return text;
}

/** The same data with `duration` set, placed after `publishedAt` so every file lists its fields in one order. */
export function withDuration<T extends { publishedAt: string }>(data: T, duration: string | null | undefined): T {
  const { duration: _old, ...rest } = data as T & { duration?: string };
  const value = normalizeDuration(duration) ?? normalizeDuration(_old);
  if (!value) return rest as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(rest)) {
    out[key] = v;
    if (key === "publishedAt") out.duration = value;
  }
  return out as T;
}
