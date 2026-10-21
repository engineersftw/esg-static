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
