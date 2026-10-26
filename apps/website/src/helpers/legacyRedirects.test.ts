import { describe, expect, it } from 'vitest';
import { cleanedFallback, cleanLegacyPath, decodePath, handleKey, handleSlugs, pastLastPage, redirectUrl, slugsById, xHandle, type Entry } from './legacyRedirects';

const presenter = (id: string, slug: string, x?: string): Entry => ({
  id,
  data: { slug, links: x ? [{ type: 'website', url: 'https://example.com/a' }, { type: 'x', url: x }] : [] },
});

describe('xHandle', () => {
  it('reads the handle from x.com and twitter.com URLs, lowercased', () => {
    expect(xHandle('https://x.com/Jane_Doe')).toBe('jane_doe');
    expect(xHandle('https://twitter.com/greywolve/')).toBe('greywolve');
    expect(xHandle('https://www.x.com/a?s=20')).toBe('a');
  });

  it('is null for other hosts, empty paths and non-URLs', () => {
    expect(xHandle('https://example.com/jane')).toBeNull();
    expect(xHandle('https://x.com/')).toBeNull();
    expect(xHandle('jane')).toBeNull();
  });
});

describe('slugsById', () => {
  it('keeps only the numeric (Rails) IDs', () => {
    expect(slugsById([presenter('7', 'jane'), presenter('abc123defg', 'new'), presenter('yt-xyz', 'v')])).toEqual({ '7': 'jane' });
  });
});

describe('handleSlugs', () => {
  it('maps lowercase handles to slugs of Rails presenters only', () => {
    const map = handleSlugs([presenter('7', 'jane-doe', 'https://x.com/Jane_Doe'), presenter('new1234567', 'newbie', 'https://x.com/newbie_x'), presenter('8', 'no-link')]);
    expect(map).toEqual({ jane_doe: 'jane-doe' });
  });

  it('gives a shared handle to the first presenter', () => {
    expect(handleSlugs([presenter('198', 'tony-a', 'https://x.com/tonybuiwr'), presenter('633', 'tony-b', 'https://x.com/TonyBuiWR')])).toEqual({ tonybuiwr: 'tony-a' });
  });

  it('leaves out a handle that is another presenter’s page slug, but keeps the presenter’s own', () => {
    const map = handleSlugs([presenter('1', 'jacklenox', 'https://x.com/jacklenox'), presenter('2', 'bob', 'https://x.com/bob_x'), presenter('3', 'other', 'https://x.com/Bob')]);
    expect(map).toEqual({ jacklenox: 'jacklenox', bob_x: 'bob' });
  });
});

describe('cleanLegacyPath', () => {
  it('drops a search-engine tracking tail', () => {
    expect(cleanLegacyPath('/video/declarative-vs-imperative-programming-talk-js--1005&sa=U')).toBe('/video/declarative-vs-imperative-programming-talk-js--1005');
    expect(cleanLegacyPath('/presenter/jane-doe&sa=U&ved=2ah')).toBe('/presenter/jane-doe');
  });

  it('drops a stray /null after a video, presenter or organization', () => {
    expect(cleanLegacyPath('/video/sg-geek-girls-maker-series-3-with-cindy-lin/null')).toBe('/video/sg-geek-girls-maker-series-3-with-cindy-lin');
    expect(cleanLegacyPath('/organization/rubysg/null/')).toBe('/organization/rubysg');
  });

  it('drops a stray /true the same way', () => {
    expect(cleanLegacyPath('/organization/aws-user-group-singapore/true')).toBe('/organization/aws-user-group-singapore');
    expect(cleanLegacyPath('/presenter/jane-doe/true/')).toBe('/presenter/jane-doe');
    expect(cleanLegacyPath('/video/some-talk/true')).toBe('/video/some-talk');
  });

  it('drops trailing backslashes', () => {
    expect(cleanLegacyPath('/video/css-code-splitting-talk-css--3273\\')).toBe('/video/css-code-splitting-talk-css--3273');
    expect(cleanLegacyPath('/presenter/ken-lee--1229\\\\\\')).toBe('/presenter/ken-lee--1229');
  });

  it('drops the feed’s trailing slashes', () => {
    expect(cleanLegacyPath('/feed/')).toBe('/feed');
    expect(cleanLegacyPath('//feed/')).toBe('/feed');
  });

  it('sends a bare tracking tail to the home page', () => {
    expect(cleanLegacyPath('/&sa=U')).toBe('/');
  });

  it('leaves every other path alone', () => {
    for (const path of ['/video/some-talk', '/video/null', '/video/true', '/playlist/x/true', '/video/a/b/null', '/playlist/x/null', '/', '/v/601']) {
      expect(cleanLegacyPath(path)).toBe(path);
    }
  });
});

describe('handleKey', () => {
  it('lowercases and drops a leading @', () => {
    expect(handleKey('@GrahamDumpleton')).toBe('grahamdumpleton');
    expect(handleKey('jane')).toBe('jane');
  });
});

describe('pastLastPage', () => {
  it('finds the entry behind a page-number path', () => {
    expect(pastLastPage('/organization/geekcampsg/5')).toEqual({ kind: 'organization', slug: 'geekcampsg' });
    expect(pastLastPage('/presenter/jane-doe/12/')).toEqual({ kind: 'presenter', slug: 'jane-doe' });
  });

  it('ignores everything else', () => {
    for (const path of ['/organization/geekcampsg', '/organization/a/b', '/video/x/2', '/conference/x/2']) expect(pastLastPage(path)).toBeNull();
  });
});

describe('cleanedFallback', () => {
  it('is the clean path when it changed', () => {
    expect(cleanedFallback('/video/some-talk/null', '/video/some-talk')).toBe('/video/some-talk');
    expect(cleanedFallback('//feed/', '/feed')).toBe('/feed');
    expect(cleanedFallback('/&sa=U', '/')).toBe('/');
  });

  it('is null when nothing changed', () => {
    expect(cleanedFallback('/video/some-talk', '/video/some-talk')).toBeNull();
  });

  it('never points at another site', () => {
    expect(cleanedFallback('//evil.com&sa=U', cleanLegacyPath('//evil.com&sa=U'))).toBeNull();
    expect(cleanedFallback('//evil.com\\', cleanLegacyPath('//evil.com\\'))).toBeNull();
    expect(cleanedFallback('/\\evil.com&sa=U', cleanLegacyPath('/\\evil.com&sa=U'))).toBeNull();
    expect(cleanedFallback('///evil.com&sa=U', cleanLegacyPath('///evil.com&sa=U'))).toBeNull();
  });
});

describe('decodePath', () => {
  it('decodes valid percent-encoding', () => {
    expect(decodePath('/video/caf%C3%A9')).toBe('/video/café');
  });

  it('is null for invalid percent-encoding, which the function leaves to the static 404', () => {
    expect(decodePath('/%c0%ae%c0%ae/')).toBeNull();
    expect(decodePath('/video/100%-uptime--123')).toBeNull();
  });
});

describe('redirectUrl', () => {
  const url = (path: string) => new URL(`https://engineers.sg${path}`);

  it('keeps the query string on the site', () => {
    expect(redirectUrl('/video/a-talk', url('/v/601?t=30'))?.href).toBe('https://engineers.sg/video/a-talk?t=30');
  });

  it('refuses a path that parses as another site', () => {
    // `new URL` drops the tab, so "/\t/evil.com" would otherwise be https://evil.com/
    const cleaned = cleanLegacyPath(decodeURIComponent('/%09/evil.com%5C'));
    const location = cleanedFallback('/\t/evil.com\\', cleaned);
    expect(location).toBe('/\t/evil.com');
    expect(redirectUrl(location!, url('/%09/evil.com%5C'))).toBeNull();
    expect(redirectUrl('/\n/evil.com', url('/'))).toBeNull();
  });
});
