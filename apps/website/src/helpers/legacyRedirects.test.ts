import { describe, expect, it } from 'vitest';
import { cleanLegacyPath, handleSlugs, slugsById, xHandle, type Entry } from './legacyRedirects';

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

  it('leaves out a handle that is a presenter page slug, including the presenter’s own', () => {
    const map = handleSlugs([presenter('1', 'jacklenox', 'https://x.com/jacklenox'), presenter('2', 'bob', 'https://x.com/bob_x'), presenter('3', 'other', 'https://x.com/Bob')]);
    expect(map).toEqual({ bob_x: 'bob' });
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

  it('sends a bare tracking tail to the home page', () => {
    expect(cleanLegacyPath('/&sa=U')).toBe('/');
  });

  it('leaves every other path alone', () => {
    for (const path of ['/video/some-talk', '/video/null', '/video/a/b/null', '/playlist/x/null', '/', '/v/601']) {
      expect(cleanLegacyPath(path)).toBe(path);
    }
  });
});
