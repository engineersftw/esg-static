// A video's length for the thumbnail badge. The content stores the ISO 8601 duration YouTube
// reports (`PT27M13S`, see @esg/content's duration.ts); this turns it into `27:13` or `1:02:03`.
// The website doesn't depend on @esg/content, so the pattern is repeated here.

export const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** The length in whole seconds, or null for a missing, zero or malformed duration. */
export function durationSeconds(iso: string | null | undefined): number | null {
  const m = iso ? ISO_DURATION.exec(iso) : null;
  if (!m) return null;
  const [days, hours, minutes, seconds] = m.slice(1).map((part) => Number(part ?? 0));
  const total = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  return total > 0 ? total : null;
}

/** `27:13`, or `1:02:03` from an hour up (days count as 24 hours); null when there is no length. */
export function formatDuration(iso: string | null | undefined): string | null {
  const total = durationSeconds(iso);
  if (total === null) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
