// /cal: the old Rails subscription URL, now an iCalendar (.ics) of every upcoming tech event in
// Singapore, made at build time from DevsGoWhere's events feed (https://devsgowhere.com/events.json,
// set another with EVENTS_FEED_URL). `helpers/events.ts` reads the feed and `helpers/ical.ts` writes
// the file. A static file, so a calendar polling it costs no Function requests. It is only as fresh as
// the last deploy, so the site is rebuilt daily.
//
// It is a dynamic route with a single path only so that it can be left out: when the feed can't be
// read, no /cal is built and the URL answers 404 rather than a calendar with no events, which
// subscribed calendars would take as "every event was cancelled". Apps keep what they had on an error.
// public/_headers sets the content type, since the file has no extension.
import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from 'astro';
import { fetchEvents } from '../helpers/events';
import { icalCalendar } from '../helpers/ical';

const FEED_URL = process.env.EVENTS_FEED_URL || 'https://devsgowhere.com/events.json';

export const getStaticPaths = (async () => {
  const feed = await fetchEvents(FEED_URL);
  if (!feed) {
    console.warn('/cal not built: the events feed could not be read');
    return [];
  }
  return [{ params: { cal: 'cal' }, props: { feed } }];
}) satisfies GetStaticPaths;

type Props = InferGetStaticPropsType<typeof getStaticPaths>;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(
    icalCalendar(props.feed.events, {
      name: 'Engineers.SG Events',
      description: 'Upcoming tech events in Singapore, from DevsGoWhere (devsgowhere.com).',
      prodId: '-//Engineers.SG//Events//EN',
      now: new Date(),
    }),
    { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } },
  );
