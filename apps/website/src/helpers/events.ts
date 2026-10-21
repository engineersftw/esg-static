// The events feed behind /cal: DevsGoWhere's `events.json` (https://devsgowhere.com/events.json),
// every upcoming tech event in Singapore, read once at build time (src/pages/[cal].ts) and turned into
// an iCalendar file by ical.ts. Pure TypeScript apart from `fetchEvents`, which takes the `fetch` it
// uses, so the tests run it directly.
//
// The feed is a JSON object: `{ "version": 1, "generatedAt", "events": [ … ] }`. Every event has an
// `id` (stable, even when the event is rescheduled: it becomes the calendar UID), a `title` and a
// `start` as full ISO 8601 with its offset; everything else may be null. An event that doesn't meet
// that is skipped, so one bad entry can't take the calendar down.

export interface CalendarEvent {
  /** DevsGoWhere's event ID, `<org_id>/<YYYYMMDD-slug>`. Stable, so calendars update an event in place. */
  id: string;
  title: string;
  /** A short plain-text description. */
  description: string | null;
  /** The event's page on DevsGoWhere. */
  url: string | null;
  /** Where to sign up (Meetup, Luma, …). */
  rsvpUrl: string | null;
  start: Date;
  end: Date | null;
  venue: string | null;
  venueAddress: string | null;
  org: { id: string; title: string; url: string | null } | null;
  tags: string[];
  /** When the event's entry was last edited by hand, if it says. */
  updatedAt: Date | null;
}

export interface EventsFeed {
  generatedAt: Date | null;
  events: CalendarEvent[];
  /** How many entries were left out for missing an ID, title or start. */
  skipped: number;
}

const FEED_VERSION = 1;

/** A full ISO 8601 date and time with a `Z` or an offset: a time without one would be a guess. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A non-empty string, trimmed, else null. */
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function instant(value: unknown): Date | null {
  const s = text(value);
  if (!s || !INSTANT.test(s)) return null;
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An instant, or a bare `YYYY-MM-DD` taken as midnight UTC. */
function when(value: unknown): Date | null {
  const s = text(value);
  if (s && DATE_ONLY.test(s)) {
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return instant(value);
}

function parseEvent(value: unknown): CalendarEvent | null {
  const e = record(value);
  const id = text(e?.id);
  const title = text(e?.title);
  const start = instant(e?.start);
  if (!e || !id || !title || !start) return null;
  const org = record(e.org);
  const orgId = text(org?.id);
  const orgTitle = text(org?.title);
  return {
    id,
    title,
    description: text(e.description),
    url: text(e.url),
    rsvpUrl: text(e.rsvpUrl),
    start,
    end: instant(e.end),
    venue: text(e.venue),
    venueAddress: text(e.venueAddress),
    org: orgId && orgTitle ? { id: orgId, title: orgTitle, url: text(org?.url) } : null,
    tags: Array.isArray(e.tags) ? e.tags.flatMap((tag) => text(tag) ?? []) : [],
    updatedAt: when(e.updatedAt),
  };
}

/** The events in a feed, or null when it isn't a version 1 feed at all. */
export function parseEventsFeed(data: unknown): EventsFeed | null {
  const feed = record(data);
  if (!feed || feed.version !== FEED_VERSION || !Array.isArray(feed.events)) return null;
  const events = feed.events.flatMap((entry) => parseEvent(entry) ?? []);
  return { generatedAt: instant(feed.generatedAt), events, skipped: feed.events.length - events.length };
}

/** Sent with the request, so the feed's owner can see who is reading it. */
const USER_AGENT = 'Engineers.SG calendar build (+https://engineers.sg)';

export interface FetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  warn?: (message: string) => void;
}

/** Reads the feed, or returns null (after a warning) when it can't: unreachable, not OK, not JSON, or the wrong shape. */
export async function fetchEvents(url: string, options: FetchOptions = {}): Promise<EventsFeed | null> {
  const { fetch: fetchFeed = fetch, timeoutMs = 15_000, warn = console.warn } = options;
  try {
    const response = await fetchFeed(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      warn(`events feed ${url}: HTTP ${response.status}`);
      return null;
    }
    const feed = parseEventsFeed(await response.json());
    if (!feed) warn(`events feed ${url}: not a version ${FEED_VERSION} events feed`);
    else if (feed.skipped > 0) warn(`events feed ${url}: skipped ${feed.skipped} entries without an id, title or start`);
    return feed;
  } catch (error) {
    warn(`events feed ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
