import type { Env } from "../../shared/types";
import { renderRenameTemplate, sanitizePathLike, seasonEpisode, splitExt, parseSeasonEpisodeFromName } from "../../shared/rename";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  if (context.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Cloudflare Workers 的 Request.json 不是泛型，这里直接断言
  const req = (await context.request.json().catch(() => null)) as any;
  if (!req) return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400 });

  const mediaType = (req.mediaType || "tv") as "tv" | "movie" | "anime";
  const series = req.series || {};
  const episodes = (req.episodes || []) as Array<{ seasonNumber: number; episodeNumber: number; title?: string; aired?: string }>;
  const rename = req.rename || {};
  const originals: string[] = Array.isArray(rename.originals) ? rename.originals : [];

  const tvFormat =
    rename.tvFormat ||
    `{{ title }}{% if year %} ({{ year }}){% endif %}/Season {{ season }}/{{ title }} - {{ season_episode }}{% if episode_title %} - {{ episode_title }}{% endif %}{{ fileExt }}`;

  const movieFormat =
    rename.movieFormat ||
    `{{ title }}{% if year %} ({{ year }}){% endif %}/{{ title }}{% if year %} ({{ year }}){% endif %}{{ fileExt }}`;

  const nfoNameMode = (rename.nfoNameMode || "both") as "standard" | "same_as_media" | "both";

  const epsSorted = [...episodes].sort((a, b) => (a.seasonNumber - b.seasonNumber) || (a.episodeNumber - b.episodeNumber));
  let fallbackIdx = 0;

  const rows: any[] = [];

  for (const originalRaw of originals.slice(0, 50)) {
    const original = (originalRaw || "").trim();
    if (!original) continue;

    const { ext } = splitExt(original);

    let s = 1, e = 1, episodeTitle = "";
    const parsed = parseSeasonEpisodeFromName(original);

    if (parsed.season !== null && parsed.episode !== null) {
      s = parsed.season; e = parsed.episode;
      const hit = epsSorted.find((x) => x.seasonNumber === s && x.episodeNumber === e);
      episodeTitle = hit?.title || "";
    } else {
      const ep = epsSorted[fallbackIdx] || null;
      s = ep?.seasonNumber || 1;
      e = ep?.episodeNumber || (fallbackIdx + 1);
      episodeTitle = ep?.title || "";
      fallbackIdx++;
    }

    const ctxBase: any = {
      title: series.title || "",
      original_title: series.originalTitle || "",
      year: series.year || "",
      season: s,
      episode: e,
      season_episode: seasonEpisode(s, e),
      episode_title: episodeTitle,
      fileExt: ext || "",
      original_name: original,
      customization: rename.customization || ""
    };

    const mediaPath =
      mediaType === "movie"
        ? sanitizePathLike(renderRenameTemplate(movieFormat, ctxBase))
        : sanitizePathLike(renderRenameTemplate(tvFormat, ctxBase));

    // 同名 NFO：用原文件名去扩展名 + .nfo（只预览，不改你文件）
    const baseNoExt = splitExt(original).base;
    const sameNameNfo = `${baseNoExt}.nfo`;

    rows.push({
      original,
      parsed: { season: s, episode: e },
      mediaPath,
      nfoPreview:
        nfoNameMode === "standard"
          ? [`S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}.nfo`]
          : nfoNameMode === "same_as_media"
          ? [sameNameNfo]
          : [
              `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}.nfo`,
              sameNameNfo
            ]
    });
  }

  return new Response(JSON.stringify({ rows }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
