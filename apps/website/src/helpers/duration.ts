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

/**
 * The length in words for running text, next to a date: `45 sec`, `13 min`, `1 hr 2 min`, `2 hr`. From a
 * minute up it rounds to the nearest minute, since the seconds don't help anyone plan their time;
 * `formatDuration` keeps the exact `12:37` for the thumbnail badge.
 */
export function describeDuration(iso: string | null | undefined): string | null {
  const total = durationSeconds(iso);
  if (total === null) return null;
  if (total < 60) return `${total} sec`;
  const minutes = Math.round(total / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
