// Video thumbnails for cards. The content stores three YouTube sizes (120, 320 and 480 px wide),
// and the card crops the 480 px one to 16:9. A card is wider than that on a phone (about 1,100 device
// pixels at 3x), so for YouTube videos the browser may also pick the 1280 px `maxresdefault` of the
// same video, which isn't stored: most videos have one, and thumbnailFallback.ts falls back to the
// stored thumbnail when it doesn't.

export interface ThumbnailSource {
  /** The stored thumbnail, used when there is no `srcset`, and as the fallback. */
  src: string;
  /** Set for YouTube thumbnails: the stored one and the large one, with their widths. */
  srcset?: string;
}

const HQ_URL = /\/hqdefault\.jpg$/;

/** Widths of the stored high-quality thumbnail and of `maxresdefault`. */
const HQ_WIDTH = 480;
const MAXRES_WIDTH = 1280;

/** The best stored thumbnail, and where one exists a larger version for sharp screens; null when a video has none. */
export function thumbnailSource(thumbnails: {
  high: string | null;
  medium: string | null;
  default: string | null;
}): ThumbnailSource | null {
  const src = thumbnails.high ?? thumbnails.medium ?? thumbnails.default;
  if (!src) return null;
  if (!HQ_URL.test(src)) return { src };
  return { src, srcset: `${src} ${HQ_WIDTH}w, ${src.replace(HQ_URL, '/maxresdefault.jpg')} ${MAXRES_WIDTH}w` };
}

/**
 * Whether a loaded large thumbnail is YouTube's stand-in for a missing one. It answers a missing
 * `maxresdefault` with a 404 status but still sends a small 120x90 (4:3) picture, which the browser
 * shows as if it had loaded. A real large thumbnail is 16:9, so anything squarer is the stand-in.
 */
export const isStandIn = (naturalWidth: number, naturalHeight: number) =>
  naturalHeight > 0 && naturalWidth / naturalHeight < 1.5;

/** What the card's width is, for the browser to pick a size from `srcset`: the full width on a phone, else the column. */
export const CARD_SIZES = '(max-width: 720px) 100vw, 464px';
export const FEATURED_SIZES = '(max-width: 720px) 100vw, 960px';
