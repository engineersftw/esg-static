// Old Rails URL /feed (Atom). Now RSS 2.0, newest active videos first; public/_headers sets the
// content type, since a file with no extension would otherwise be served as a download.
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getListedVideos } from '../helpers/collections';

const FEED_SIZE = 50;

export async function GET(context: APIContext) {
  const videos = (await getListedVideos()).slice(0, FEED_SIZE);
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: videos.map((video) => ({
      title: video.data.videoTitle,
      link: `/video/${video.data.slug}`,
      pubDate: new Date(video.data.publishedAt),
      description: video.body,
    })),
  });
}
