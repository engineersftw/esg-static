import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './events';
import { escapeText, foldLine, icalCalendar, icalTime, stripControl } from './ical';

const now = new Date('2026-10-21T16:00:00Z');
const options = { name: 'Engineers.SG Events', prodId: '-//Engineers.SG//Events//EN', now };

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'techies/20261022-new-dev-roles',
  title: 'Tech Talk',
  description: 'A short talk.',
  url: 'https://devsgowhere.com/events/techies/20261022-new-dev-roles/',
  rsvpUrl: 'https://luma.com/i8iy0fzc',
  start: new Date('2026-10-22T18:30:00+08:00'),
  end: new Date('2026-10-22T20:30:00+08:00'),
  venue: 'SGInnovate',
  venueAddress: '32 Carpenter St',
  org: { id: 'techies', title: 'Techies', url: null },
  tags: ['talk', 'ai'],
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  ...over,
});

/** The file as unfolded content lines. */
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('escapeText', () => {
  it('escapes backslash, semicolon and comma, and turns line breaks into \\n', () => {
    expect(escapeText('a, b; c\\d')).toBe('a\\, b\\; c\\\\d');
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
  });
});

describe('stripControl', () => {
  it('drops control characters but keeps a tab, accents and emoji', () => {
    expect(stripControl('a\r\nb\u0000c\u007fd\te é 🎉')).toBe('abcd\te é 🎉');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Hello')).toBe('SUMMARY:Hello');
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
  });

  it('folds at 75 bytes, and unfolding gives back the line', () => {
    const line = 'DESCRIPTION:' + 'word '.repeat(60);
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const part of physical) expect(bytes(part)).toBeLessThanOrEqual(75);
    for (const part of physical.slice(1)) expect(part.startsWith(' ')).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = 'SUMMARY:' + 'Café 🎉 '.repeat(30);
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(bytes(part)).toBeLessThanOrEqual(75);
      expect(part).not.toContain('�');
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('icalTime', () => {
  it('writes UTC as basic ISO 8601', () => {
    expect(icalTime(new Date('2026-10-22T18:30:00+08:00'))).toBe('20261022T103000Z');
    expect(icalTime(new Date('2026-10-22T00:05:09+08:00'))).toBe('20261021T160509Z');
  });
});

describe('icalCalendar', () => {
  it('wraps the events in a calendar with CRLF line endings and refresh hints', () => {
    const ics = icalCalendar([event()], { ...options, description: 'Upcoming events' });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    const l = lines(ics);
    expect(l).toContain('PRODID:-//Engineers.SG//Events//EN');
    expect(l).toContain('METHOD:PUBLISH');
    expect(l).toContain('X-WR-CALNAME:Engineers.SG Events');
    expect(l).toContain('X-WR-CALDESC:Upcoming events');
    expect(l).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
    expect(l).toContain('X-PUBLISHED-TTL:PT6H');
  });

  it('writes an event with a stable UID, UTC times and its details', () => {
    const l = lines(icalCalendar([event()], options));
    expect(l).toContain('UID:techies/20261022-new-dev-roles@devsgowhere.com');
    expect(l).toContain('DTSTAMP:20261021T160000Z');
    expect(l).toContain('DTSTART:20261022T103000Z');
    expect(l).toContain('DTEND:20261022T123000Z');
    expect(l).toContain('SUMMARY:Tech Talk');
    expect(l).toContain('LOCATION:SGInnovate\\, 32 Carpenter St');
    expect(l).toContain('URL:https://devsgowhere.com/events/techies/20261022-new-dev-roles/');
    expect(l).toContain('CATEGORIES:Techies,talk,ai');
    expect(l).toContain('LAST-MODIFIED:20261020T000000Z');
    expect(l).toContain('STATUS:CONFIRMED');
    expect(l).toContain(
      'DESCRIPTION:Organized by Techies\\n\\nA short talk.\\n\\nRSVP: https://luma.com/i8iy0fzc\\nDetails: https://devsgowhere.com/events/techies/20261022-new-dev-roles/',
    );
  });

  it('escapes the UID as TEXT, and leaves an ordinary ID as it is', () => {
    const uid = (id: string) => lines(icalCalendar([event({ id })], options)).find((line) => line.startsWith('UID:'));
    expect(uid('techies/20261022-new-dev-roles')).toBe('UID:techies/20261022-new-dev-roles@devsgowhere.com');
    expect(uid('org/20261022-a,b;c\\d')).toBe('UID:org/20261022-a\\,b\\;c\\\\d@devsgowhere.com');
  });

  it('gives an event with no end, or an end before its start, the default two hours', () => {
    for (const end of [null, new Date('2026-10-22T17:00:00+08:00'), new Date('2026-10-22T18:30:00+08:00')]) {
      expect(lines(icalCalendar([event({ end })], options))).toContain('DTEND:20261022T123000Z');
    }
    expect(lines(icalCalendar([event({ end: null })], { ...options, defaultMinutes: 45 }))).toContain('DTEND:20261022T111500Z');
  });

  it('keeps a multi-day event as long as it is', () => {
    const l = lines(icalCalendar([event({ end: new Date('2026-10-24T18:00:00+08:00') })], options));
    expect(l).toContain('DTEND:20261024T100000Z');
  });

  it('leaves out the lines an event has no data for', () => {
    const bare = event({ description: null, url: null, rsvpUrl: null, venue: null, venueAddress: null, org: null, tags: [], updatedAt: null });
    const l = lines(icalCalendar([bare], options));
    for (const prefix of ['LOCATION', 'DESCRIPTION', 'URL', 'CATEGORIES', 'LAST-MODIFIED']) {
      expect(l.some((line) => line.startsWith(`${prefix}:`))).toBe(false);
    }
    expect(l).toContain('SUMMARY:Tech Talk');
  });

  it('falls back to the sign-up link for URL when there is no event page', () => {
    expect(lines(icalCalendar([event({ url: null })], options))).toContain('URL:https://luma.com/i8iy0fzc');
  });

  it('writes the location with the street address, without repeating the venue or adding a bare "Singapore"', () => {
    const at = (venue: string | null, venueAddress: string | null) =>
      lines(icalCalendar([event({ venue, venueAddress })], options)).find((line) => line.startsWith('LOCATION:'));
    expect(at('Matrix', '30 Biopolis Rd, Matrix, Singapore')).toBe('LOCATION:30 Biopolis Rd\\, Matrix\\, Singapore');
    expect(at('Matrix', 'matrix')).toBe('LOCATION:matrix');
    // The venue has to be named, not just spelled inside another word.
    expect(at('ACE', 'Race Course Road')).toBe('LOCATION:ACE\\, Race Course Road');
    expect(at('Matrix', '1 Matrixx Lane')).toBe('LOCATION:Matrix\\, 1 Matrixx Lane');
    expect(at('Lorong AI @ One-North', 'Lorong AI @ One-North, 1 Fusionopolis Way')).toBe('LOCATION:Lorong AI @ One-North\\, 1 Fusionopolis Way');
    expect(at('Café', '1 Rue, Café Lane')).toBe('LOCATION:1 Rue\\, Café Lane');
    expect(at('CAFÉ', '1 Rue du Cafés')).toBe('LOCATION:CAFÉ\\, 1 Rue du Cafés');
    expect(at('The (Old) Hall', '5 High St, The (Old) Hall')).toBe('LOCATION:5 High St\\, The (Old) Hall');
    expect(at('SGInnovate', '32 Carpenter St')).toBe('LOCATION:SGInnovate\\, 32 Carpenter St');
    expect(at('Zenika Singapore', 'Singapore')).toBe('LOCATION:Zenika Singapore');
    expect(at(null, '1 Fusionopolis Way')).toBe('LOCATION:1 Fusionopolis Way');
    expect(at('GovTech HQ', null)).toBe('LOCATION:GovTech HQ');
  });

  it('escapes text and folds long lines, with emoji intact', () => {
    const tricky = event({ title: 'AI, ML; and more 🎉\\o/', description: 'Line one\nLine two ' + 'long '.repeat(40) });
    const ics = icalCalendar([tricky], options);
    for (const physical of ics.split('\r\n')) expect(bytes(physical)).toBeLessThanOrEqual(75);
    const l = lines(ics);
    expect(l).toContain('SUMMARY:AI\\, ML\\; and more 🎉\\\\o/');
    expect(l.find((line) => line.startsWith('DESCRIPTION:'))).toContain('Line one\\nLine two long');
  });

  it('cannot be made to start a new line, whatever the feed puts in a value', () => {
    const evil = event({
      id: 'x/1\r\nBEGIN:VEVENT\r\nSUMMARY:evil',
      url: 'https://a.test/\r\nATTACH:https://evil.test',
      title: 'Title\r\nX-EVIL:1',
      description: 'Text\nBEGIN:VALARM\nACTION:DISPLAY',
      venue: 'Hall\rX-EVIL:2',
      venueAddress: '1 Road\u0000',
      org: { id: 'o', title: 'Org\nX-EVIL:3', url: null },
      tags: ['tag\r\nX-EVIL:4'],
    });
    const ics = icalCalendar([evil], options);
    const l = lines(ics);
    expect(l.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(l.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    for (const prefix of ['X-EVIL', 'ATTACH', 'BEGIN:VALARM', 'ACTION', 'SUMMARY:evil']) {
      expect(l.some((line) => line.startsWith(prefix)), prefix).toBe(false);
    }
    // Every line is one the generator wrote itself.
    const names = l.filter(Boolean).map((line) => line.split(/[:;]/)[0]);
    const allowed = new Set(['BEGIN', 'END', 'VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'X-WR-CALNAME', 'X-WR-CALDESC', 'X-WR-TIMEZONE', 'REFRESH-INTERVAL', 'X-PUBLISHED-TTL', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'LOCATION', 'DESCRIPTION', 'URL', 'CATEGORIES', 'LAST-MODIFIED', 'STATUS']);
    expect(names.filter((name) => !allowed.has(name))).toEqual([]);
    expect(ics.includes('\u0000')).toBe(false);
  });

  it('lists events by start time, then ID, whatever order they came in', () => {
    const a = event({ id: 'a/1', start: new Date('2026-10-23T10:00:00Z'), end: null });
    const b = event({ id: 'b/1', start: new Date('2026-10-22T10:00:00Z'), end: null });
    const c = event({ id: 'a/2', start: new Date('2026-10-22T10:00:00Z'), end: null });
    const uids = (events: CalendarEvent[]) => lines(icalCalendar(events, options)).filter((line) => line.startsWith('UID:'));
    expect(uids([a, b, c])).toEqual(['UID:a/2@devsgowhere.com', 'UID:b/1@devsgowhere.com', 'UID:a/1@devsgowhere.com']);
    expect(icalCalendar([a, b, c], options)).toBe(icalCalendar([c, a, b], options));
  });

  it('is a valid, empty calendar when there are no events', () => {
    const ics = icalCalendar([], options);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('does not change the events it is given', () => {
    const events = [event({ id: 'z' }), event({ id: 'a' })];
    icalCalendar(events, options);
    expect(events.map((e) => e.id)).toEqual(['z', 'a']);
  });
});
