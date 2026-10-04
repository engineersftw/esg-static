/** Builders for raw YouTube API data, shared by the tests. */
import type { RawExport } from "./transform.js";
import type { YtPlaylist, YtPlaylistItem, YtPrivacyStatus, YtVideo } from "./youtube.js";

export function video(id: string, publishedAt: string, opts: { privacy?: YtPrivacyStatus; viewCount?: string | null } = {}): YtVideo {
  return {
    id,
    snippet: {
      title: `Video ${id}`,
      description: `Speaker: Someone\n\nProduced by Engineers.SG`,
      publishedAt,
      channelId: "UCchannel",
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
        high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      },
    },
    ...(opts.viewCount === null ? {} : { statistics: { viewCount: opts.viewCount ?? "100" } }),
    status: { privacyStatus: opts.privacy ?? "public" },
  };
}

export function playlist(id: string, title: string, publishedAt: string, privacy: YtPrivacyStatus = "public"): YtPlaylist {
  return {
    id,
    snippet: {
      title,
      description: `About ${title}`,
      publishedAt,
      channelId: "UCchannel",
      thumbnails: {
        default: { url: `https://i.ytimg.com/pl/${id}/default.jpg` },
        high: { url: `https://i.ytimg.com/pl/${id}/hqdefault.jpg` },
      },
    },
    status: { privacyStatus: privacy },
  };
}

export function item(playlistId: string, videoId: string, position: number): YtPlaylistItem {
  return {
    id: `${playlistId}-${position}`,
    snippet: { playlistId, position, title: `Video ${videoId}` },
    contentDetails: { videoId },
  };
}

export function raw(parts: Partial<RawExport>): RawExport {
  return {
    fetchedAt: "2026-10-04T12:00:00.000Z",
    channel: {
      id: "UCchannel",
      snippet: { title: "Engineers.SG" },
      contentDetails: { relatedPlaylists: { uploads: "UUchannel" } },
    },
    playlists: [],
    playlistItems: {},
    videos: [],
    ...parts,
  };
}
