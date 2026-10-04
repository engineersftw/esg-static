/**
 * Row types for the Engineers.SG Postgres database, derived from backup/schema.json.
 *
 * Each type matches one row of backup/<table>.json as written by pg-export:
 * - `timestamp without time zone` columns are raw Postgres text in UTC, e.g. "2015-05-07 15:32:29.127974"
 * - `date` columns are "YYYY-MM-DD"
 * - `inet` columns are text, e.g. "203.0.113.7"
 * Nullability follows the column definitions in the schema, not the data actually present.
 */

/** Postgres `timestamp without time zone`, as text in UTC ("YYYY-MM-DD HH:MM:SS[.ffffff]"). */
export type Timestamp = string;
/** Postgres `date`, as text ("YYYY-MM-DD"). */
export type DateString = string;
/** Postgres `inet`, as text. */
export type Inet = string;

/** `episodes.video_site` integer enum (Rails enum; no Postgres type). */
export const VideoSite = {
  YouTube: 1,
  Vimeo: 2,
} as const;
export type VideoSite = (typeof VideoSite)[keyof typeof VideoSite];

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export interface Episode {
  id: number;
  /** External ID on the video site: YouTube video ID or numeric Vimeo ID. */
  video_id: string | null;
  title: string | null;
  published_at: Timestamp | null;
  description: string | null;
  /** Thumbnail URLs, smallest to largest. */
  image1: string | null;
  image2: string | null;
  image3: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  sort_order: number | null;
  /** Default true. */
  active: boolean;
  /** Default 1 (YouTube). */
  video_site: VideoSite;
  /** Default 0. */
  view_count: number | null;
}

export interface Presenter {
  id: number;
  name: string;
  biography: string | null;
  twitter: string | null;
  email: string | null;
  website: string | null;
  /** Default true. */
  active: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  byline: string | null;
  avatar_url: string | null;
}

export interface Organization {
  id: number;
  title: string;
  description: string | null;
  website: string | null;
  twitter: string | null;
  contact_person: string | null;
  /** Default true. */
  active: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  image: string | null;
  slug: string | null;
}

export interface PlaylistCategory {
  id: number;
  title: string | null;
  /** Default true. */
  active: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Playlist {
  id: number;
  /** External playlist ID on the video site (not a foreign key). */
  playlist_id: string | null;
  name: string | null;
  description: string | null;
  publish_date: DateString | null;
  image: string | null;
  /** Default true. */
  active: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  website: string | null;
  hashtag: string | null;
  /** → PlaylistCategory.id (no FK constraint). */
  playlist_category_id: number | null;
  slug: string | null;
}

export interface FeaturedVideo {
  id: number;
  /** → Episode.id (no FK constraint). */
  episode_id: number;
  /** Default 0. */
  sequence: number;
  /** Default true. */
  active: boolean;
}

export interface VideoLink {
  id: number;
  title: string | null;
  url: string | null;
  /** → Episode.id */
  episode_id: number | null;
  /** Default true. */
  active: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Join tables
// ---------------------------------------------------------------------------

export interface PlaylistItem {
  id: number;
  /** → Playlist.id (no FK constraint). */
  playlist_id: number;
  /** → Episode.id (no FK constraint). */
  episode_id: number;
  sort_order: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SubPlaylist {
  id: number;
  /** Parent → Playlist.id (no FK constraint). */
  playlist_id: number;
  /** Child → Playlist.id (no FK constraint). */
  sub_playlist_id: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Default 1. */
  sequence: number;
}

export interface VideoPresenter {
  id: number;
  /** → Episode.id */
  episode_id: number | null;
  /** → Presenter.id */
  presenter_id: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface VideoOrganization {
  id: number;
  /** → Episode.id */
  episode_id: number | null;
  /** → Organization.id */
  organization_id: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Tagging (acts-as-taggable-on)
// ---------------------------------------------------------------------------

export interface Tag {
  id: number;
  /** Unique. */
  name: string | null;
  /** Default 0. */
  taggings_count: number | null;
}

export interface Tagging {
  id: number;
  /** → Tag.id (no FK constraint). */
  tag_id: number | null;
  /** Polymorphic: id of the row named by `taggable_type`. */
  taggable_id: number | null;
  /** Rails model name; only "Episode" in the data. */
  taggable_type: string | null;
  tagger_id: number | null;
  tagger_type: string | null;
  /** varchar(128); only "tags" in the data. */
  context: string | null;
  created_at: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Admin / Rails internals
// ---------------------------------------------------------------------------

/** Devise admin account. Contains credentials: never expose to clients. */
export interface User {
  id: number;
  /** Unique. Default "". */
  email: string;
  /** Default "". */
  encrypted_password: string;
  /** Unique. */
  reset_password_token: string | null;
  reset_password_sent_at: Timestamp | null;
  remember_created_at: Timestamp | null;
  /** Default 0. */
  sign_in_count: number;
  current_sign_in_at: Timestamp | null;
  last_sign_in_at: Timestamp | null;
  current_sign_in_ip: Inet | null;
  last_sign_in_ip: Inet | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** OAuth provider. */
  provider: string | null;
  /** OAuth user ID. */
  uid: string | null;
  twitter: string | null;
}

export interface ActiveAdminComment {
  id: number;
  namespace: string | null;
  body: string | null;
  resource_id: string;
  resource_type: string;
  author_id: number | null;
  author_type: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface ArInternalMetadata {
  key: string;
  value: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchemaMigration {
  version: string;
}

// ---------------------------------------------------------------------------
// Table map
// ---------------------------------------------------------------------------

/** Table name → row type. */
export interface Tables {
  active_admin_comments: ActiveAdminComment;
  ar_internal_metadata: ArInternalMetadata;
  episodes: Episode;
  featured_videos: FeaturedVideo;
  organizations: Organization;
  playlist_categories: PlaylistCategory;
  playlist_items: PlaylistItem;
  playlists: Playlist;
  presenters: Presenter;
  schema_migrations: SchemaMigration;
  sub_playlists: SubPlaylist;
  taggings: Tagging;
  tags: Tag;
  users: User;
  video_links: VideoLink;
  video_organizations: VideoOrganization;
  video_presenters: VideoPresenter;
}

export type TableName = keyof Tables;
