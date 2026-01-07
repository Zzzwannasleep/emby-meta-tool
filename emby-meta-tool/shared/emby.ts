function xmlEscape(s: string) {
  return (s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

export type NormalizedSeries = {
  title: string;
  originalTitle?: string;
  year?: string;
  plot?: string;
  premiered?: string; // YYYY-MM-DD
  rating?: number; // 0..10
  genres?: string[];
  studios?: string[];
  actors?: string[];
  uniqueIds?: Record<string, string>; // tmdb, imdb, tvdb, bangumi, anidb...
};

export type NormalizedSeason = {
  seasonNumber: number;
  title?: string;
  plot?: string;
};

export type NormalizedEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  plot?: string;
  aired?: string; // YYYY-MM-DD
};

export function buildTvshowNfo(s: NormalizedSeries): string {
  const ids = s.uniqueIds || {};
  const uniqueIdTags = Object.entries(ids)
    .map(([k, v]) => `<uniqueid type="${xmlEscape(k)}"${k === "tmdb" ? ' default="true"' : ""}>${xmlEscape(v)}</uniqueid>`)
    .join("");

  const genreTags = (s.genres || []).map((g) => `<genre>${xmlEscape(g)}</genre>`).join("");
  const studioTags = (s.studios || []).map((g) => `<studio>${xmlEscape(g)}</studio>`).join("");
  const actorTags = (s.actors || [])
    .slice(0, 30)
    .map((a) => `<actor><name>${xmlEscape(a)}</name></actor>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${xmlEscape(s.title)}</title>
  ${s.originalTitle ? `<originaltitle>${xmlEscape(s.originalTitle)}</originaltitle>` : ""}
  ${s.year ? `<year>${xmlEscape(s.year)}</year>` : ""}
  ${s.plot ? `<plot>${xmlEscape(s.plot)}</plot>` : ""}
  ${s.premiered ? `<premiered>${xmlEscape(s.premiered)}</premiered>` : ""}
  ${Number.isFinite(s.rating as any) ? `<rating>${(s.rating as number).toFixed(1)}</rating>` : ""}
  ${uniqueIdTags}
  ${genreTags}
  ${studioTags}
  ${actorTags}
</tvshow>
`;
}

export function buildSeasonNfo(season: NormalizedSeason): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<season>
  <seasonnumber>${season.seasonNumber}</seasonnumber>
  ${season.title ? `<title>${xmlEscape(season.title)}</title>` : ""}
  ${season.plot ? `<plot>${xmlEscape(season.plot)}</plot>` : ""}
</season>
`;
}

export function buildEpisodeNfo(ep: NormalizedEpisode): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>${xmlEscape(ep.title)}</title>
  <season>${ep.seasonNumber}</season>
  <episode>${ep.episodeNumber}</episode>
  ${ep.aired ? `<aired>${xmlEscape(ep.aired)}</aired>` : ""}
  ${ep.plot ? `<plot>${xmlEscape(ep.plot)}</plot>` : ""}
</episodedetails>
`;
}

export function sanitizeFolderName(s: string) {
  return (s || "Unknown").replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function seriesRootFolderName(title: string, year?: string) {
  const safe = sanitizeFolderName(title);
  return year ? `${safe} (${year})` : safe;
}

export function seasonFolderName(seasonNumber: number) {
  return `Season ${seasonNumber}`;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function episodeNfoName(season: number, episode: number) {
  return `S${pad2(season)}E${pad2(episode)}.nfo`;
}

export function episodeThumbName(season: number, episode: number) {
  // Emby/Kodi 常用的集封面命名
  return `S${pad2(season)}E${pad2(episode)}-thumb.jpg`;
}

export function seasonPosterName(season: number) {
  // 常见季封面命名：poster.jpg 放在 Season 目录内即可被识别
  return `poster.jpg`;
}
