/**
 * Minimal YouTube Data API v3 client (API key auth, plain fetch).
 * Only the fields the exporter uses are typed.
 */

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const MAX_ATTEMPTS = 4;

export interface YtThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export type YtThumbnails = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", YtThumbnail>>;

export type YtPrivacyStatus = "public" | "unlisted" | "private";

export interface YtChannel {
  id: string;
  snippet: { title: string; customUrl?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
}

export interface YtPlaylist {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    thumbnails: YtThumbnails;
  };
  status?: { privacyStatus: YtPrivacyStatus };
}

export interface YtPlaylistItem {
  id: string;
  snippet: { playlistId: string; position: number; title: string };
  contentDetails: { videoId: string; videoPublishedAt?: string };
}

export interface YtVideo {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    channelTitle?: string;
    thumbnails: YtThumbnails;
  };
  /** Absent fields are hidden by the owner (e.g. viewCount is always present, likeCount may not be). */
  statistics?: { viewCount?: string };
  status: { privacyStatus: YtPrivacyStatus };
}

interface ListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

interface ApiError {
  error?: { code: number; message: string; errors?: { reason: string }[] };
}

const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError"]);

export class YouTubeClient {
  /** Every list call used here costs 1 quota unit (of 10,000/day by default). */
  quotaUsed = 0;

  constructor(private readonly apiKey: string) {}

  async get<T>(resource: string, params: Record<string, string>): Promise<ListResponse<T>> {
    const url = new URL(`${BASE_URL}/${resource}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", this.apiKey);

    for (let attempt = 1; ; attempt++) {
      this.quotaUsed++;
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as ListResponse<T>;

      const body = (await res.json().catch(() => ({}))) as ApiError;
      const reason = body.error?.errors?.[0]?.reason ?? "";
      const retryable = res.status >= 500 || res.status === 429 || RETRYABLE_REASONS.has(reason);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        const detail = body.error?.message ?? res.statusText;
        throw new Error(`YouTube API ${resource} failed (${res.status}${reason ? ` ${reason}` : ""}): ${detail}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }

  /** Follow nextPageToken until exhausted. */
  async listAll<T>(resource: string, params: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<T>(resource, { ...params, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /** Look up by id in batches of 50 (the API's per-request limit). */
  async listByIds<T>(resource: string, ids: string[], params: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const page = await this.get<T>(resource, { ...params, id: ids.slice(i, i + 50).join(",") });
      items.push(...(page.items ?? []));
    }
    return items;
  }

  /** Accepts a channel ID (UC…) or a handle (with or without @). */
  async getChannel(channel: string): Promise<YtChannel> {
    const byId = /^UC[\w-]{22}$/.test(channel);
    const res = await this.get<YtChannel>("channels", {
      part: "snippet,contentDetails",
      ...(byId ? { id: channel } : { forHandle: channel }),
    });
    const found = res.items?.[0];
    if (!found) throw new Error(`Channel not found: ${channel}`);
    return found;
  }

  getChannelPlaylists(channelId: string): Promise<YtPlaylist[]> {
    return this.listAll<YtPlaylist>("playlists", { part: "snippet,status", channelId });
  }

  getPlaylists(ids: string[]): Promise<YtPlaylist[]> {
    return this.listByIds<YtPlaylist>("playlists", ids, { part: "snippet,status" });
  }

  getPlaylistItems(playlistId: string): Promise<YtPlaylistItem[]> {
    return this.listAll<YtPlaylistItem>("playlistItems", { part: "snippet,contentDetails", playlistId });
  }

  getVideos(ids: string[]): Promise<YtVideo[]> {
    return this.listByIds<YtVideo>("videos", ids, { part: "snippet,statistics,status" });
  }
}
