import { type CollectionEntry, getCollection } from 'astro:content';

const newestFirst = (a: CollectionEntry<'video'>, b: CollectionEntry<'video'>) =>
  b.data.publishedAt.localeCompare(a.data.publishedAt) || Number(b.id) - Number(a.id);

/** Videos shown in listings: newest first, without inactive (unlisted) ones. */
export async function getListedVideos() {
  return (await getCollection('video', (video) => video.data.active)).sort(newestFirst);
}

/** Drop inactive videos from resolved references, keeping their order. */
export const listed = (videos: CollectionEntry<'video'>[]) => videos.filter((video) => video.data.active);
