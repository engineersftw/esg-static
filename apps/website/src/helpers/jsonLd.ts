// schema.org JSON-LD for the pages (rendered by BaseHead's `jsonLd` prop). Pure: pages pass plain
// values, and every URL is made absolute from `site`. Nothing private goes in: no emails.
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { durationSeconds } from './duration';

type Site = URL | string;
type Json = Record<string, unknown>;

interface Named {
  name: string;
  slug: string;
}
interface Link {
  url: string;
}

const absolute = (path: string, site: Site) => new URL(path, site).href;
const text = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() || undefined;

/** Drops null, undefined and empty values, so absent fields leave no keys behind. */
function prune<T extends Json>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)),
  ) as T;
}

/** The home page: the site as a `WebSite` with its search, and the organization behind it. */
export function siteJsonLd(site: Site): Json[] {
  const origin = absolute('/', site);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${origin}#website`,
      url: origin,
      name: SITE_TITLE,
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${origin}#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${absolute('/search', site)}?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${origin}#organization`,
      name: SITE_TITLE,
      url: origin,
      logo: absolute('/engineerssg-logo.png', site),
      description: SITE_DESCRIPTION,
    },
  ];
}

export interface VideoLdInput {
  site: Site;
  slug: string;
  title: string;
  description?: string | null;
  /** ISO 8601 timestamp. */
  publishedAt: string;
  /** ISO 8601 duration (`PT27M13S`), as stored in the content. */
  duration?: string | null;
  thumbnails: (string | null | undefined)[];
  videoId: string;
  videoSite: 'youtube' | 'vimeo';
  presenters: Named[];
  organizations: Named[];
}

export function videoJsonLd(input: VideoLdInput): Json {
  const { site, videoId } = input;
  const embedUrl =
    input.videoSite === 'youtube' ? `https://www.youtube.com/embed/${videoId}` : `https://player.vimeo.com/video/${videoId}`;
  return prune({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    '@id': `${absolute(`/video/${input.slug}`, site)}#video`,
    url: absolute(`/video/${input.slug}`, site),
    name: text(input.title),
    description: text(input.description) ?? text(input.title),
    uploadDate: new Date(input.publishedAt).toISOString(),
    duration: durationSeconds(input.duration) ? input.duration : undefined,
    thumbnailUrl: input.thumbnails.filter((t): t is string => !!t).map((t) => absolute(t, site)),
    embedUrl,
    creator: input.presenters.map((p) => ({ '@type': 'Person', name: text(p.name), url: absolute(`/presenter/${p.slug}`, site) })),
    publisher: input.organizations.map((o) => ({ '@type': 'Organization', name: text(o.name), url: absolute(`/organization/${o.slug}`, site) })),
  });
}

export interface ProfileLdInput {
  site: Site;
  slug: string;
  name: string;
  image?: string | null;
  description?: string | null;
  links: Link[];
}

/** A presenter, as a `Person`. Their links (X, LinkedIn, …) are `sameAs`. */
export function personJsonLd(input: ProfileLdInput & { byline?: string | null }): Json {
  const url = absolute(`/presenter/${input.slug}`, input.site);
  return prune({
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${url}#person`,
    url,
    name: text(input.name),
    description: text(input.description) ?? text(input.byline),
    image: input.image ? absolute(input.image, input.site) : undefined,
    sameAs: input.links.map((l) => l.url),
  });
}

/** An organization (a meetup or community), as an `Organization`. `website` is its own site or meetup page. */
export function organizationJsonLd(input: ProfileLdInput & { website?: string | null }): Json {
  const url = absolute(`/organization/${input.slug}`, input.site);
  return prune({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${url}#organization`,
    url,
    name: text(input.name),
    description: text(input.description),
    logo: input.image ? absolute(input.image, input.site) : undefined,
    sameAs: input.links.map((l) => l.url),
  });
}

/** A conference or playlist page: a `CollectionPage` about the playlist, listing the first page of its videos. */
export function playlistJsonLd(input: {
  site: Site;
  path: string;
  title: string;
  description?: string | null;
  image?: string | null;
  /** ISO 8601 timestamp. */
  publishDate?: string | null;
  videos: Named[];
}): Json {
  const url = absolute(input.path, input.site);
  return prune({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#playlist`,
    url,
    name: text(input.title),
    description: text(input.description),
    image: input.image ? absolute(input.image, input.site) : undefined,
    datePublished: input.publishDate ? new Date(input.publishDate).toISOString() : undefined,
    hasPart: input.videos.map((v) => ({ '@type': 'VideoObject', name: text(v.name), url: absolute(`/video/${v.slug}`, input.site) })),
  });
}

/**
 * The JSON for a `<script type="application/ld+json">`. `<` and the line separators are escaped,
 * so no text (a description, a title) can close the script tag or break the page.
 */
export function serializeJsonLd(data: Json | Json[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('[\\u2028\\u2029]', 'g'), (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}
