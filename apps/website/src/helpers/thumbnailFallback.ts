// Browser side of helpers/thumbnails.ts: a card image with a `srcset` goes back to its stored
// thumbnail (`data-fallback`) when the large one fails to load or turns out to be YouTube's
// stand-in for a missing one. One capturing listener covers every card, including the search
// results that are added later; load and error events don't bubble, so it listens on the capture phase.
import { isStandIn } from './thumbnails';

function check(img: HTMLImageElement) {
  if (!img.hasAttribute('srcset') || !img.dataset.fallback) return;
  const failed = img.complete && img.naturalWidth === 0;
  if (!failed && !(img.complete && isStandIn(img.naturalWidth, img.naturalHeight))) return;
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.src = img.dataset.fallback;
}

export function watchThumbnails() {
  const onEvent = (event: Event) => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('video-card-image')) check(event.target);
  };
  document.addEventListener('load', onEvent, true);
  document.addEventListener('error', onEvent, true);
  // Images that finished before this script ran.
  document.querySelectorAll<HTMLImageElement>('img.video-card-image[srcset]').forEach(check);
}
