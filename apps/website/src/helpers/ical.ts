// An iCalendar (RFC 5545) file from the events feed (events.ts), for the /cal subscription URL
// (src/pages/[cal].ts). Pure, so the tests run it directly.
//
// Times are written in UTC (`20261022T103000Z`), so the file needs no VTIMEZONE and every calendar
// shows them in its own zone. The UID is the feed's event ID, which stays the same when an event is
// rescheduled, so a calendar updates the event instead of adding a second one. Lines end in CRLF,
// text is escaped, and long lines are folded at 75 bytes, never inside a multi-byte character.
import type { CalendarEvent } from './events';

export interface IcalOptions {
  /** Shown as the calendar's name. */
  name: string;
  description?: string;
  /** Identifies the program that made the file, `-//Owner//Product//EN`. */
  prodId: string;
  /** The `DTSTAMP` of every event: when the file was made. */
  now: Date;
  /** What follows `@` in each UID. The IDs are DevsGoWhere's, so this is its domain. */
  uidDomain?: string;
  /** How long an event with no end time lasts. */
  defaultMinutes?: number;
  /** How often calendar apps are asked to look for changes. */
  refreshHours?: number;
}

const MAX_LINE_BYTES = 75;
const encoder = new TextEncoder();

/** Control characters other than a tab (a stray CR or LF would start a new line in the file). */
const isControl = (code: number) => (code < 0x20 && code !== 0x09) || code === 0x7f;

/** The value without its control characters: for the ones written as they are, a UID and a URL. */
export function stripControl(value: string): string {
  return Array.from(value)
    .filter((char) => !isControl(char.charCodeAt(0)))
    .join('');
}

/** TEXT values: backslash, semicolon and comma are escaped, a line break is `\n`, other control characters are dropped. */
export function escapeText(value: string): string {
  return stripControl(value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'));
}

/**
 * Folds a content line to at most 75 bytes per physical line: the rest goes on following lines that
 * start with one space. It splits between characters, so a multi-byte one (an accent, an emoji) is never cut.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_BYTES) return line;
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // A continuation line begins with a space, which counts toward its 75 bytes.
    const limit = lines.length === 0 ? MAX_LINE_BYTES : MAX_LINE_BYTES - 1;
    if (bytes + size > limit) {
      lines.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n ');
}

/** `20261022T103000Z`. */
export const icalTime = (date: Date): string => date.toISOString().replace(/[-:]|\.\d{3}/g, '');

/** Whether `text` has `name` in it as a name: not as part of a longer word (`ACE` is not in `Race Course Road`). */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * The venue and its address. An address that already names the venue is used alone (it has the street
 * for directions), and one that says just "Singapore" adds nothing, so the venue stands alone.
 */
function location(event: CalendarEvent): string | null {
  const { venue, venueAddress } = event;
  if (!venue) return venueAddress;
  if (!venueAddress) return venue;
  const address = venueAddress.toLowerCase();
  if (address === 'singapore') return venue;
  return mentions(venueAddress, venue) ? venueAddress : `${venue}, ${venueAddress}`;
}

function description(event: CalendarEvent): string | null {
  const paragraphs = [event.org && `Organized by ${event.org.title}`, event.description].filter(Boolean);
  const links = [event.rsvpUrl && `RSVP: ${event.rsvpUrl}`, event.url && `Details: ${event.url}`].filter(Boolean);
  const parts = [paragraphs.join('\n\n'), links.join('\n')].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function vevent(event: CalendarEvent, options: Required<Pick<IcalOptions, 'now' | 'uidDomain' | 'defaultMinutes'>>): string[] {
  const end =
    event.end && event.end > event.start ? event.end : new Date(event.start.getTime() + options.defaultMinutes * 60_000);
  const where = location(event);
  const about = description(event);
  const categories = [...new Set([...(event.org ? [event.org.title] : []), ...event.tags])];
  const url = event.url ?? event.rsvpUrl;
  return [
    'BEGIN:VEVENT',
    `UID:${stripControl(event.id)}@${options.uidDomain}`,
    `DTSTAMP:${icalTime(options.now)}`,
    `DTSTART:${icalTime(event.start)}`,
    `DTEND:${icalTime(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(where ? [`LOCATION:${escapeText(where)}`] : []),
    ...(about ? [`DESCRIPTION:${escapeText(about)}`] : []),
    ...(url ? [`URL:${stripControl(url)}`] : []),
    ...(categories.length > 0 ? [`CATEGORIES:${categories.map(escapeText).join(',')}`] : []),
    ...(event.updatedAt ? [`LAST-MODIFIED:${icalTime(event.updatedAt)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
  ];
}

/** The whole calendar, events in start order (ties by ID), so the same feed always gives the same file. */
export function icalCalendar(events: CalendarEvent[], options: IcalOptions): string {
  const { uidDomain = 'devsgowhere.com', defaultMinutes = 120, refreshHours = 6, now } = options;
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${options.prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    ...(options.description ? [`X-WR-CALDESC:${escapeText(options.description)}`] : []),
    'X-WR-TIMEZONE:Asia/Singapore',
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`,
    `X-PUBLISHED-TTL:PT${refreshHours}H`,
    ...sorted.flatMap((event) => vevent(event, { now, uidDomain, defaultMinutes })),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
