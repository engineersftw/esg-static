import { describe, expect, it } from 'vitest';
import { organizationJsonLd, personJsonLd, playlistJsonLd, serializeJsonLd, siteJsonLd, videoJsonLd } from './jsonLd';

const site = new URL('https://engineers.sg');

describe('siteJsonLd', () => {
  it('describes the site, its search and its organization', () => {
    const [website, organization] = siteJsonLd(site);
    expect(website['@type']).toBe('WebSite');
    expect(JSON.stringify(website)).toContain('https://engineers.sg/search?q={search_term_string}');
    expect(organization['@type']).toBe('Organization');
    expect(organization.logo).toBe('https://engineers.sg/engineerssg-logo.png');
  });
});

describe('videoJsonLd', () => {
  const base = {
    site,
    slug: 'a-talk',
    title: ' A  talk ',
    publishedAt: '2023-11-03T06:41:58Z',
    thumbnails: ['https://i.ytimg.com/vi/x/hqdefault.jpg', null],
    videoId: 'abc123',
    videoSite: 'youtube' as const,
    presenters: [{ name: 'Jane Doe', slug: 'jane-doe' }],
    organizations: [],
  };

  it('builds a VideoObject with absolute URLs', () => {
    const ld = videoJsonLd({ ...base, description: 'About\n  it' });
    expect(ld).toMatchObject({
      '@type': 'VideoObject',
      url: 'https://engineers.sg/video/a-talk',
      name: 'A talk',
      description: 'About it',
      uploadDate: '2023-11-03T06:41:58.000Z',
      thumbnailUrl: ['https://i.ytimg.com/vi/x/hqdefault.jpg'],
      embedUrl: 'https://www.youtube.com/embed/abc123',
      creator: [{ '@type': 'Person', name: 'Jane Doe', url: 'https://engineers.sg/presenter/jane-doe' }],
    });
  });

  it('adds the duration as ISO 8601, and leaves out a missing or zero one', () => {
    expect(videoJsonLd({ ...base, duration: 'PT27M13S' })).toMatchObject({ duration: 'PT27M13S' });
    for (const duration of [undefined, null, 'P0D', 'nonsense']) expect(videoJsonLd({ ...base, duration })).not.toHaveProperty('duration');
  });

  it('falls back to the title, leaves out empty lists and embeds Vimeo', () => {
    const ld = videoJsonLd({ ...base, videoSite: 'vimeo', description: '' });
    expect(ld.description).toBe('A talk');
    expect(ld).not.toHaveProperty('publisher');
    expect(ld.embedUrl).toBe('https://player.vimeo.com/video/abc123');
  });
});

describe('personJsonLd and organizationJsonLd', () => {
  it('make local images absolute and carry the links as sameAs', () => {
    const person = personJsonLd({ site, slug: 'jane', name: 'Jane', image: '/images/presenters/7.jpg', links: [{ url: 'https://x.com/jane' }], byline: 'Acme' });
    expect(person).toMatchObject({ '@type': 'Person', image: 'https://engineers.sg/images/presenters/7.jpg', sameAs: ['https://x.com/jane'], description: 'Acme' });
    const org = organizationJsonLd({ site, slug: 'rubysg', name: 'RubySG', image: null, links: [] });
    expect(org).toEqual({ '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://engineers.sg/organization/rubysg#organization', url: 'https://engineers.sg/organization/rubysg', name: 'RubySG' });
  });
});

describe('playlistJsonLd', () => {
  it('lists the videos and dates it', () => {
    const ld = playlistJsonLd({ site, path: '/conference/pycon', title: 'PyCon', publishDate: '2019-11-11', videos: [{ name: 'Talk', slug: 'talk' }] });
    expect(ld).toMatchObject({ '@type': 'CollectionPage', datePublished: '2019-11-11T00:00:00.000Z', hasPart: [{ '@type': 'VideoObject', url: 'https://engineers.sg/video/talk' }] });
  });
});

describe('serializeJsonLd', () => {
  it('cannot close the script tag', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>\u2028' });
    expect(json).not.toContain('<');
    expect(JSON.parse(json).name).toContain('</script>');
  });
});
