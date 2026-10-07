import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { PROFILE_LINK_TYPES } from './consts';

// Markdown written by pg-export (`-f markdown`), one <id>.md per entry; frontmatter types are in
// @esg/db-types/content. The glob loader would otherwise use the frontmatter `slug` as the entry
// ID, but references between collections use the database ID, which is the file name.
const fromContent = (collection: string) =>
  glob({
    pattern: '*.md',
    base: `./content/${collection}`,
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  });

const video = defineCollection({
  loader: fromContent('video'),
  schema: z.object({
    id: z.string(),
    videoId: z.string(),
    videoTitle: z.string(),
    publishedAt: z.string(),
    thumbnailDefault: z.string().nullable(),
    thumbnailMedium: z.string().nullable(),
    thumbnailHigh: z.string().nullable(),
    slug: z.string(),
    organizations: z.array(reference('organization')),
    presenters: z.array(reference('presenter')),
    playlists: z.array(reference('playlist')),
    active: z.boolean(),
    videoSite: z.enum(['youtube', 'vimeo']),
  }),
});

// A presenter's or organization's links, in display order (ProfileLink in @esg/db-types/content).
const links = z.array(
  z.object({
    type: z.enum(PROFILE_LINK_TYPES),
    url: z.url({ protocol: /^https?$/ }),
  }),
);

const organization = defineCollection({
  loader: fromContent('organization'),
  schema: z.object({
    id: z.string(),
    orgTitle: z.string(),
    links,
    logoImage: z.string().nullable(),
    contactPerson: z.string().nullable(),
    slug: z.string(),
    active: z.boolean(),
    videos: z.array(reference('video')),
  }),
});

const presenter = defineCollection({
  loader: fromContent('presenter'),
  schema: z.object({
    id: z.string(),
    presenterName: z.string(),
    presenterByline: z.string().nullable(),
    links,
    email: z.string().nullable(),
    imageUrl: z.string().nullable(),
    slug: z.string(),
    active: z.boolean(),
    videos: z.array(reference('video')),
  }),
});

const playlist = defineCollection({
  loader: fromContent('playlist'),
  schema: z.object({
    id: z.string(),
    playlistId: z.string().nullable(),
    playlistTitle: z.string(),
    publishDate: z.string().nullable(),
    image: z.string().nullable(),
    website: z.string().nullable(),
    hashtag: z.string().nullable(),
    category: z.string().nullable(),
    slug: z.string(),
    active: z.boolean(),
    videos: z.array(reference('video')),
    subPlaylists: z.array(reference('playlist')),
  }),
});

export const collections = { video, organization, presenter, playlist };
