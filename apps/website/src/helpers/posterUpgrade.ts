// Browser side of the video page's player poster. The page starts the player on YouTube's
// `hqdefault` thumbnail, which every video has, and puts the sharper `maxresdefault` in
// `data-poster-max`. Many videos have no `maxresdefault`: YouTube answers with a 404 status but still
// sends a small gray 120x90 picture, which a CSS background shows as if it had loaded. So the large one
// is loaded off-screen first, and only a real one (not the stand-in, see isStandIn) replaces the poster.
import { isStandIn } from './thumbnails';

export function upgradePosters(root: ParentNode = document) {
  for (const player of root.querySelectorAll<HTMLElement>('lite-youtube[data-poster-max]')) {
    const url = player.dataset.posterMax!;
    const image = new Image();
    image.onload = () => {
      if (!isStandIn(image.naturalWidth, image.naturalHeight)) player.style.backgroundImage = `url('${url}')`;
    };
    image.src = url;
  }
}
