import { afterEach, describe, expect, it, vi } from 'vitest';
import { upgradePosters } from './posterUpgrade';

// No DOM here: a stand-in for `Image` that the test completes by hand, and plain objects for the players.
class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = '';
  constructor() {
    FakeImage.all.push(this);
  }
  /** What the browser does when the request finishes with a picture of this size. */
  load(width: number, height: number) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.();
  }
}

const HQ = "url('https://i.ytimg.com/vi/abc/hqdefault.jpg')";
const MAX = 'https://i.ytimg.com/vi/abc/maxresdefault.jpg';

const player = () => ({ dataset: { posterMax: MAX }, style: { backgroundImage: HQ } });
const rootOf = (...players: ReturnType<typeof player>[]) => ({ querySelectorAll: () => players }) as unknown as ParentNode;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeImage.all = [];
});

describe('upgradePosters', () => {
  it('requests the large poster off-screen and keeps the safe one until it arrives', () => {
    vi.stubGlobal('Image', FakeImage);
    const p = player();
    upgradePosters(rootOf(p));
    expect(FakeImage.all.map((image) => image.src)).toEqual([MAX]);
    expect(p.style.backgroundImage).toBe(HQ);
  });

  it('swaps in a real 16:9 large poster', () => {
    vi.stubGlobal('Image', FakeImage);
    const p = player();
    upgradePosters(rootOf(p));
    FakeImage.all[0].load(1280, 720);
    expect(p.style.backgroundImage).toBe(`url('${MAX}')`);
  });

  it("keeps the poster when YouTube sends its 120x90 stand-in for a missing large one", () => {
    vi.stubGlobal('Image', FakeImage);
    const p = player();
    upgradePosters(rootOf(p));
    FakeImage.all[0].load(120, 90);
    expect(p.style.backgroundImage).toBe(HQ);
  });

  it('keeps the poster when the request fails', () => {
    vi.stubGlobal('Image', FakeImage);
    const p = player();
    upgradePosters(rootOf(p));
    // A failed request never calls onload.
    expect(p.style.backgroundImage).toBe(HQ);
  });

  it('handles each player on its own', () => {
    vi.stubGlobal('Image', FakeImage);
    const [real, missing] = [player(), player()];
    upgradePosters(rootOf(real, missing));
    FakeImage.all[0].load(1280, 720);
    FakeImage.all[1].load(120, 90);
    expect(real.style.backgroundImage).toBe(`url('${MAX}')`);
    expect(missing.style.backgroundImage).toBe(HQ);
  });

  it('does nothing on a page without a player', () => {
    vi.stubGlobal('Image', FakeImage);
    upgradePosters(rootOf());
    expect(FakeImage.all).toEqual([]);
  });
});
