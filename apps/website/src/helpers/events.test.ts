import { describe, expect, it, vi } from 'vitest';
import { fetchEvents, parseEventsFeed } from './events';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'techies/20261022-new-dev-roles',
  title: 'Tech Talk: New Dev Roles',
  description: 'A short talk.',
  url: 'https://devsgowhere.com/events/techies/20261022-new-dev-roles/',
  rsvpUrl: 'https://luma.com/i8iy0fzc',
  start: '2026-10-22T18:30:00+08:00',
  end: '2026-10-22T20:30:00+08:00',
  timezone: 'Asia/Singapore',
  venue: 'SGInnovate',
  venueAddress: '32 Carpenter St',
  org: { id: 'techies', title: 'Techies', url: 'https://devsgowhere.com/orgs/techies/' },
  tags: ['talk', 'ai'],
  updatedAt: '2026-10-20',
  ...over,
});
const feed = (events: unknown[] = [event()], over: Record<string, unknown> = {}) => ({
  version: 1,
  generatedAt: '2026-10-21T16:00:00Z',
  events,
  ...over,
});

describe('parseEventsFeed', () => {
  it('reads a version 1 feed into events with real dates', () => {
    const parsed = parseEventsFeed(feed())!;
    expect(parsed.skipped).toBe(0);
    expect(parsed.generatedAt?.toISOString()).toBe('2026-10-21T16:00:00.000Z');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      id: 'techies/20261022-new-dev-roles',
      title: 'Tech Talk: New Dev Roles',
      venue: 'SGInnovate',
      org: { id: 'techies', title: 'Techies', url: 'https://devsgowhere.com/orgs/techies/' },
      tags: ['talk', 'ai'],
    });
    expect(parsed.events[0].start.toISOString()).toBe('2026-10-22T10:30:00.000Z');
    expect(parsed.events[0].end?.toISOString()).toBe('2026-10-22T12:30:00.000Z');
    expect(parsed.events[0].updatedAt?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('treats null, empty and missing optional fields as null', () => {
    const [e] = parseEventsFeed(
      feed([event({ description: null, url: '', rsvpUrl: '  ', end: null, venue: null, venueAddress: undefined, org: null, tags: null, updatedAt: null })]),
    )!.events;
    expect(e).toMatchObject({ description: null, url: null, rsvpUrl: null, end: null, venue: null, venueAddress: null, org: null, tags: [], updatedAt: null });
  });

  it('skips an entry with no id, title or usable start, and counts it', () => {
    const bad = [
      event({ id: '' }),
      event({ title: null }),
      event({ start: null }),
      event({ start: '2026-10-22T18:30:00' }), // no offset: a guess
      event({ start: '2026-10-22' }),
      event({ start: 'next Thursday' }),
      null,
      'nope',
    ];
    const parsed = parseEventsFeed(feed([event(), ...bad]))!;
    expect(parsed.events.map((e) => e.id)).toEqual(['techies/20261022-new-dev-roles']);
    expect(parsed.skipped).toBe(bad.length);
  });

  it('skips a start on a day that does not exist, instead of moving the event to another day', () => {
    const impossible = ['2026-02-30T10:00:00+08:00', '2026-04-31T09:00:00+08:00', '2027-02-29T10:00:00+08:00', '2026-00-10T10:00:00+08:00', '2026-06-00T10:00:00Z'];
    const parsed = parseEventsFeed(feed(impossible.map((start, i) => event({ id: `x/${i}`, start }))))!;
    expect(parsed.events).toEqual([]);
    expect(parsed.skipped).toBe(impossible.length);
    // A leap day is a day.
    const [leap] = parseEventsFeed(feed([event({ start: '2028-02-29T10:00:00+08:00', end: null })]))!.events;
    expect(leap.start.toISOString()).toBe('2028-02-29T02:00:00.000Z');
  });

  it('ignores an end or an update date that does not exist', () => {
    const [e] = parseEventsFeed(feed([event({ end: '2026-10-32T20:30:00+08:00', updatedAt: '2026-02-30' })]))!.events;
    expect(e.end).toBeNull();
    expect(e.updatedAt).toBeNull();
    const [ok] = parseEventsFeed(feed([event({ updatedAt: '2028-02-29' })]))!.events;
    expect(ok.updatedAt?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('skips an event whose id has a control character, which could start a new line in the calendar', () => {
    const bad = ['x/1\r\nBEGIN:VEVENT', 'x/1\nSUMMARY:evil', 'x/\u00001', 'x/\t1'];
    const parsed = parseEventsFeed(feed([event(), ...bad.map((id) => event({ id }))]))!;
    expect(parsed.events.map((e) => e.id)).toEqual(['techies/20261022-new-dev-roles']);
    expect(parsed.skipped).toBe(bad.length);
  });

  it('keeps only http(s) links without spaces or control characters', () => {
    const good = ['https://luma.com/i8iy0fzc', 'http://example.com/a?b=c&d=e#f'];
    for (const link of good) expect(parseEventsFeed(feed([event({ url: link, rsvpUrl: link, org: { id: 'o', title: 'O', url: link } })]))!.events[0]).toMatchObject({ url: link, rsvpUrl: link, org: { url: link } });
    const bad = ['javascript:alert(1)', 'data:text/calendar,x', 'ftp://example.com/x', '//example.com/x', '/events/x', 'not a url', 'https://example.com/a b', 'https://example.com/\r\nATTACH:https://evil.test', 'https://example.com/\u0000'];
    for (const link of bad) {
      const [e] = parseEventsFeed(feed([event({ url: link, rsvpUrl: link, org: { id: 'o', title: 'O', url: link } })]))!.events;
      expect(e.url, link).toBeNull();
      expect(e.rsvpUrl, link).toBeNull();
      expect(e.org?.url, link).toBeNull();
    }
  });

  it('ignores a bad end time, a tag that is not text, and an org with no title', () => {
    const [e] = parseEventsFeed(feed([event({ end: 'late', tags: ['ok', 3, '', null], org: { id: 'x' } })]))!.events;
    expect(e.end).toBeNull();
    expect(e.tags).toEqual(['ok']);
    expect(e.org).toBeNull();
  });

  it('accepts Z and fractional seconds', () => {
    const [e] = parseEventsFeed(feed([event({ start: '2026-10-22T10:30:00.000Z', end: null })]))!.events;
    expect(e.start.toISOString()).toBe('2026-10-22T10:30:00.000Z');
  });

  it('is not a feed unless it is a version 1 object with an events list', () => {
    for (const data of [null, [], 'x', {}, { events: [] }, feed([], { version: 2 }), { version: 1, events: 'no' }]) {
      expect(parseEventsFeed(data)).toBeNull();
    }
    expect(parseEventsFeed(feed([]))).toEqual({ generatedAt: new Date('2026-10-21T16:00:00Z'), events: [], skipped: 0 });
  });
});

describe('fetchEvents', () => {
  const response = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
    ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }) as unknown as Response;

  it('returns the parsed feed', async () => {
    const warn = vi.fn();
    const fetch = vi.fn(async () => response(feed()));
    const result = await fetchEvents('https://example.test/events.json', { fetch, warn });
    expect(result?.events).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith('https://example.test/events.json', expect.objectContaining({ headers: { Accept: 'application/json', 'User-Agent': expect.stringContaining('Engineers.SG') } }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about skipped entries but still returns the rest', async () => {
    const warn = vi.fn();
    const result = await fetchEvents('u', { fetch: async () => response(feed([event(), { id: 'x' }])), warn });
    expect(result?.events).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped 1'));
  });

  it('returns null with a warning when the feed is down, not OK, not JSON or the wrong shape', async () => {
    const cases: [string, typeof fetch][] = [
      ['network', async () => Promise.reject(new Error('connection refused'))],
      ['status', async () => response({}, { ok: false, status: 503 })],
      ['json', async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('bad json')) }) as unknown as Response],
      ['shape', async () => response({ version: 2, events: [] })],
    ];
    for (const [, fetch] of cases) {
      const warn = vi.fn();
      expect(await fetchEvents('https://example.test/events.json', { fetch, warn })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('https://example.test/events.json');
    }
  });
});
