import type { Env } from "./types";
import { getThrottle, throttleMap } from "./throttle";

const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdbFetch(env: Env, path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { "accept": "application/json" } });
  if (!res.ok) throw new Error(`TMDB 请求失败 ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json<any>();
}

export async function tmdbSearch(env: Env, mediaType: "tv" | "movie", q: string, lang: string) {
  const data = await tmdbFetch(env, `/search/${mediaType}`, { query: q, language: lang, include_adult: 0 });
  return (data.results || []).slice(0, 20).map((r: any) => ({
    source: "tmdb",
    id: String(r.id),
    title: r.name || r.title || "Untitled",
    year: (r.first_air_date || r.release_date || "").slice(0, 4) || "",
    subtitle: r.overview || "",
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : ""
  }));
}

export async function tmdbGetDetails(env: Env, mediaType: "tv" | "movie", id: string, lang: string) {
  const append = mediaType === "tv" ? "external_ids,images,content_ratings,credits" : "external_ids,images,release_dates,credits";
  return tmdbFetch(env, `/${mediaType}/${id}`, { language: lang, append_to_response: append, include_image_language: `${lang},en,null` });
}

export async function tmdbListEpisodeGroups(env: Env, tvId: string) {
  // v3 endpoint：/tv/{tv_id}/episode_groups
  return tmdbFetch(env, `/tv/${tvId}/episode_groups`, {});
}

export async function tmdbGetEpisodeGroup(env: Env, groupId: string, lang: string) {
  // v3 endpoint：/tv/episode_group/{group_id}
  return tmdbFetch(env, `/tv/episode_group/${groupId}`, { language: lang });
}

export async function tmdbGetTvSeason(env: Env, tvId: string, seasonNumber: number, lang: string) {
  return tmdbFetch(env, `/tv/${tvId}/season/${seasonNumber}`, { language: lang });
}

export async function downloadImagesToMap(env: Env, urls: { key: string; url: string }[], onProgress?: (i: number, total: number, msg: string) => void) {
  const { concurrency, delayMs } = getThrottle(env as any);
  const total = urls.length;

  const entries = await throttleMap(urls, concurrency, delayMs, async (u, idx) => {
    onProgress?.(idx + 1, total, `下载图片 ${idx + 1}/${total}: ${u.key}`);
    const res = await fetch(u.url);
    if (!res.ok) throw new Error(`下载图片失败 ${res.status}: ${u.url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return [u.key, buf] as const;
  });

  return Object.fromEntries(entries) as Record<string, Uint8Array>;
}
