import type { Env } from "../../shared/types";
import { aiFillMissing } from "../../shared/ai";
import { makeZip, textFile } from "../../shared/zip";
import {
  buildEpisodeNfo,
  buildSeasonNfo,
  buildTvshowNfo,
  episodeNfoName,
  episodeThumbName,
  seasonPosterName,
  seasonFolderName,
  seriesRootFolderName
} from "../../shared/emby";
import { downloadImagesToMap, tmdbGetDetails, tmdbGetEpisodeGroup, tmdbGetTvSeason } from "../../shared/tmdb";
import { bangumiGetEpisodes, bangumiGetSubject } from "../../shared/bangumi";
import {
  renderRenameTemplate,
  sanitizePathLike,
  seasonEpisode,
  splitExt,
  parseSeasonEpisodeFromName
} from "../../shared/rename";

export const onRequest = async (context: any) => {
  const env = context.env as Env;

  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const req = await context.request.json<any>().catch(() => null);
  if (!req) return new Response("Bad JSON", { status: 400 });

  const source = (req.source || "tmdb") as "tmdb" | "bangumi" | "anidb" | "manual";
  const mediaType = (req.mediaType || "tv") as "tv" | "movie" | "anime";
  const lang = (req.lang || "zh-CN") as string;
  const id = (req.id || null) as string | null;
  const episodeGroupId = (req.episodeGroupId || null) as string | null;
  const useAI = !!req.useAI;
  const manual = req.manual || {};

  // ✅ 手动季集结构
  const manualStructure = (req.manualStructure || null) as
    | null
    | {
        seasons: number;
        episodesPerSeason?: number;
        seasonEpisodeMap?: Record<string, number>;
        episodeTitleTemplate?: string;
        seasonPlots?: Record<string, string>;
        episodePlots?: Record<string, string>;
      };

  const manualEpisode = (req.manualEpisode || null) as
    | null
    | {
        seasonNumber: number;
        episodeNumber: number;
        title?: string;
        plot?: string;
        aired?: string;
      };

  // ✅ 重命名配置（新增 nfoNameMode）
  const rename = (req.rename || null) as
    | null
    | {
        tvFormat?: string;
        movieFormat?: string;
        customization?: string;
        originals?: string[];
        nfoNameMode?: "standard" | "same_as_media" | "both";
      };

  const images = (req.images || null) as
    | null
    | {
        seasons?: Record<string, string>; // seasonNumber -> dataURL
        episodes?: Record<string, string>; // `${season}-${episode}` -> dataURL
      };

  const dataUrlToUint8 = (dataUrl: string | undefined | null): Uint8Array | null => {
    if (!dataUrl) return null;
    const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!m) return null;
    const b64 = m[2];
    const binary =
      typeof atob === "function"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("binary");
    const len = binary.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
    return u8;
  };

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => controller.enqueue(encodeSSE(event, data));
      const fail = (message: string) => {
        send("error", { message });
        controller.close();
      };

      try {
        send("progress", { step: "初始化", current: 0, total: 0, message: "准备开始…" });

        // 1) 拉取/构造基础元数据
        let series: any = {
          title: manual.title || "",
          originalTitle: manual.originalTitle || "",
          year: manual.year || "",
          plot: manual.plot || "",
          premiered: manual.premiered || "",
          rating: manual.rating ? Number(manual.rating) : undefined,
          genres: splitList(manual.genres),
          studios: splitList(manual.studios),
          actors: splitList(manual.actors),
          uniqueIds: {}
        };

        let seasons: Array<{ seasonNumber: number; title?: string; plot?: string }> = [];
        let episodes: Array<{ seasonNumber: number; episodeNumber: number; title: string; plot?: string; aired?: string }> =
          [];
        let imageQueue: Array<{ key: string; url: string }> = [];

        if (source === "tmdb") {
          if (!id) throw new Error("TMDB 必须提供 ID（TV/Movie ID）或先检索选择。");
          const tm = mediaType === "movie" ? "movie" : "tv";
          send("progress", { step: "拉取 TMDB 详情", current: 0, total: 0, message: `TMDB /${tm}/${id}` });

          const detail = await tmdbGetDetails(env, tm, id, lang);

          series.title = series.title || detail.name || detail.title || "";
          series.originalTitle = series.originalTitle || detail.original_name || detail.original_title || "";
          series.year = series.year || (detail.first_air_date || detail.release_date || "").slice(0, 4) || "";
          series.plot = series.plot || detail.overview || "";
          series.premiered = series.premiered || detail.first_air_date || detail.release_date || "";
          series.rating = Number.isFinite(series.rating) ? series.rating : (detail.vote_average ?? undefined);

          const ids: any = detail.external_ids || {};
          series.uniqueIds = {
            ...(series.uniqueIds || {}),
            tmdb: String(detail.id),
            imdb: ids.imdb_id ? String(ids.imdb_id) : undefined
          };

          series.genres = (series.genres?.length ? series.genres : (detail.genres || []).map((g: any) => g.name)).filter(Boolean);
          series.studios = (
            series.studios?.length ? series.studios : (detail.networks || detail.production_companies || []).map((x: any) => x.name)
          ).filter(Boolean);

          if (!series.actors?.length) {
            const cast = detail.credits?.cast || [];
            series.actors = cast.slice(0, 20).map((c: any) => c.name).filter(Boolean);
          }

          if (detail.poster_path) imageQueue.push({ key: "poster.jpg", url: `https://image.tmdb.org/t/p/original${detail.poster_path}` });
          const backdrops = (detail.images?.backdrops || []).slice(0, 1);
          if (backdrops[0]?.file_path) imageQueue.push({ key: "fanart.jpg", url: `https://image.tmdb.org/t/p/original${backdrops[0].file_path}` });

          if (tm === "tv") {
            if (episodeGroupId) {
              send("progress", { step: "拉取剧集组", current: 0, total: 0, message: `TMDB episode_group ${episodeGroupId}` });
              const g = await tmdbGetEpisodeGroup(env, episodeGroupId, lang);

              const groups = g?.groups || [];
              let seasonNo = 1;
              for (const sg of groups) {
                const seasonTitle = sg.name || `Season ${seasonNo}`;
                seasons.push({ seasonNumber: seasonNo, title: seasonTitle, plot: sg.description || "" });

                const eps = sg.episodes || [];
                let epNo = 1;
                for (const e of eps) {
                  episodes.push({
                    seasonNumber: seasonNo,
                    episodeNumber: epNo++,
                    title: e.name || `Episode ${epNo - 1}`,
                    plot: e.overview || "",
                    aired: e.air_date || ""
                  });
                }
                seasonNo++;
              }
            }

            if (!episodes.length) {
              const seasonList = (detail.seasons || []).filter(
                (s: any) => typeof s.season_number === "number" && s.season_number >= 0
              );
              send("progress", { step: "拉取季信息", current: 0, total: seasonList.length, message: `共 ${seasonList.length} 季（默认季集）` });

              for (let i = 0; i < seasonList.length; i++) {
                const sn = seasonList[i].season_number;
                send("progress", { step: "拉取季信息", current: i + 1, total: seasonList.length, message: `拉取 Season ${sn}` });
                const sd = await tmdbGetTvSeason(env, id, sn, lang);

                if (sn > 0) seasons.push({ seasonNumber: sn, title: sd.name || `Season ${sn}`, plot: sd.overview || "" });

                const eps = sd.episodes || [];
                for (const e of eps) {
                  episodes.push({
                    seasonNumber: sn,
                    episodeNumber: e.episode_number,
                    title: e.name || "",
                    plot: e.overview || "",
                    aired: e.air_date || ""
                  });
                }
              }
            }
          }
        } else if (source === "bangumi") {
          if (!id) throw new Error("Bangumi 必须提供 subject id 或先检索选择。");
          send("progress", { step: "拉取 Bangumi 详情", current: 0, total: 0, message: `Bangumi /subject/${id}` });
          const sub = await bangumiGetSubject(env, id);

          series.title = series.title || sub.name_cn || sub.name || "";
          series.originalTitle = series.originalTitle || sub.name || "";
          series.plot = series.plot || sub.summary || "";
          series.uniqueIds = { ...(series.uniqueIds || {}), bangumi: String(sub.id) };
          if (sub.images?.large) imageQueue.push({ key: "poster.jpg", url: sub.images.large });

          send("progress", { step: "拉取 Bangumi 章节", current: 0, total: 0, message: `Bangumi /subject/${id}/ep` });
          const eps = await bangumiGetEpisodes(env, id);
          const list = eps?.data || eps?.eps || [];
          const normal = list
            .filter((x: any) => x.type === 0 || x.type === 1)
            .sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));

          seasons = [{ seasonNumber: 1, title: "Season 1", plot: "" }];
          episodes = normal.map((e: any, idx: number) => ({
            seasonNumber: 1,
            episodeNumber: Number.isFinite(e.sort) ? Number(e.sort) : idx + 1,
            title: e.name_cn || e.name || `Episode ${idx + 1}`,
            plot: e.desc || "",
            aired: e.airdate || ""
          }));
        } else if (source === "anidb") {
          if (!id) throw new Error("AniDB 必须提供 AID 或先用索引检索选中。");
          send("progress", { step: "AniDB 处理", current: 0, total: 0, message: `AniDB AID=${id}（建议配合手工填写或AI补全）` });
          series.uniqueIds = { ...(series.uniqueIds || {}), anidb: String(id) };

          if (!seasons.length) seasons = [{ seasonNumber: 1, title: "Season 1", plot: "" }];
          if (!episodes.length) {
            episodes = [{ seasonNumber: 1, episodeNumber: 1, title: series.title || "Episode 1", plot: "", aired: "" }];
          }
        } else if (source === "manual") {
          send("progress", { step: "手动结构", current: 0, total: 0, message: "使用手动季/集结构生成…" });

          const sCount = Math.max(1, Number(manualStructure?.seasons || 1));
          const per = manualStructure?.episodesPerSeason ? Math.max(1, Number(manualStructure.episodesPerSeason)) : null;
          const map = manualStructure?.seasonEpisodeMap || {};
          const titleTpl = manualStructure?.episodeTitleTemplate || "Episode {{ episode }}";
          const seasonPlots = manualStructure?.seasonPlots || {};
          const episodePlots = manualStructure?.episodePlots || {};

          const manualEp = manualEpisode && Number(manualEpisode.seasonNumber) && Number(manualEpisode.episodeNumber) ? manualEpisode : null;

          seasons = [];
          episodes = [];

          if (manualEp) {
            const s = Math.max(1, Number(manualEp.seasonNumber));
            const e = Math.max(1, Number(manualEp.episodeNumber));
            const ctx = {
              season: s,
              episode: e,
              season_episode: seasonEpisode(s, e),
              title: series.title || "",
              year: series.year || ""
            };
            const epTitle = manualEp.title || renderRenameTemplate(titleTpl, ctx) || `Episode ${e}`;
            seasons.push({ seasonNumber: s, title: `Season ${s}`, plot: seasonPlots[String(s)] || "" });
            episodes.push({
              seasonNumber: s,
              episodeNumber: e,
              title: epTitle,
              plot: manualEp.plot || episodePlots[`${s}-${e}`] || "",
              aired: manualEp.aired || ""
            });
          } else {
            for (let s = 1; s <= sCount; s++) {
              const epCount = Number(map[String(s)]) || per || 1;
              seasons.push({ seasonNumber: s, title: `Season ${s}`, plot: seasonPlots[String(s)] || "" });

              for (let e = 1; e <= epCount; e++) {
                const ctx = {
                  season: s,
                  episode: e,
                  season_episode: seasonEpisode(s, e),
                  title: series.title || "",
                  year: series.year || ""
                };
                const epTitle = renderRenameTemplate(titleTpl, ctx) || `Episode ${e}`;
                episodes.push({
                  seasonNumber: s,
                  episodeNumber: e,
                  title: epTitle,
                  plot: episodePlots[`${s}-${e}`] || "",
                  aired: ""
                });
              }
            }
          }
        }

        // 2) AI 补全（可选）
        if (useAI) {
          send("progress", { step: "AI 补全", current: 0, total: 0, message: "调用 AI 补全缺失字段…" });
          const filled = await aiFillMissing(env, series);
          series = mergeSeries(series, filled);
          send("progress", { step: "AI 补全", current: 0, total: 0, message: "AI 补全完成" });
        }

        // 3) 生成 Emby 目录结构
        const rootName = seriesRootFolderName(series.title || "Unknown", series.year || "");
        send("progress", { step: "生成 NFO", current: 0, total: 0, message: `根目录：${rootName}` });

        const files: Record<string, Uint8Array> = {};
        files[`${rootName}/tvshow.nfo`] = textFile(buildTvshowNfo(series));

        const seasonSet = new Set<number>();
        for (const s of seasons) seasonSet.add(s.seasonNumber);
        for (const e of episodes) seasonSet.add(e.seasonNumber);

        const seasonNums = Array.from(seasonSet).sort((a, b) => a - b);

        // 同名 NFO 映射：season-episode -> 原始文件名
        const originals = Array.isArray(rename?.originals) ? rename!.originals! : [];
        const sameNameMap = new Map<string, string>();
        for (const o of originals) {
          const p = parseSeasonEpisodeFromName(o || "");
          if (p.season !== null && p.episode !== null) {
            sameNameMap.set(`${p.season}-${p.episode}`, (o || "").trim());
          }
        }

        const nfoNameMode = (rename?.nfoNameMode || "both") as "standard" | "same_as_media" | "both";

        for (const sn of seasonNums) {
          const folder = `${rootName}/${seasonFolderName(sn)}`;
          const sObj = seasons.find((x) => x.seasonNumber === sn) || { seasonNumber: sn, title: `Season ${sn}`, plot: "" };
          files[`${folder}/season.nfo`] = textFile(buildSeasonNfo(sObj));
          const seasonImg = images?.seasons?.[String(sn)];
          const seasonBuf = dataUrlToUint8(seasonImg);
          if (seasonBuf) {
            files[`${folder}/${seasonPosterName(sn)}`] = seasonBuf;
          }

          const eps = episodes
            .filter((x) => x.seasonNumber === sn)
            .sort((a, b) => a.episodeNumber - b.episodeNumber);

          for (const ep of eps) {
            const content = textFile(buildEpisodeNfo(ep));

            // 1) 标准：SxxEyy.nfo（最稳）
            if (nfoNameMode === "standard" || nfoNameMode === "both") {
              files[`${folder}/${episodeNfoName(sn, ep.episodeNumber)}`] = content;
            }

            // 2) 同名：<媒体同名>.nfo（仅当 originals 能解析出该集）
            if (nfoNameMode === "same_as_media" || nfoNameMode === "both") {
              const orig = sameNameMap.get(`${sn}-${ep.episodeNumber}`);
              if (orig) {
                const base = splitExt(orig).base;
                const safe = base.replace(/[\\:*?"<>|]/g, "_");
                files[`${folder}/${safe}.nfo`] = content;
              }
            }

            const epImg = images?.episodes?.[`${sn}-${ep.episodeNumber}`];
            const epBuf = dataUrlToUint8(epImg);
            if (epBuf) {
              files[`${folder}/${episodeThumbName(sn, ep.episodeNumber)}`] = epBuf;
            }
          }
        }

        // 4) 图片下载（如有）
        if (imageQueue.length) {
          send("progress", { step: "下载图片", current: 0, total: imageQueue.length, message: `共 ${imageQueue.length} 张` });
          const imgMap = await downloadImagesToMap(
            env,
            imageQueue.map((x) => ({ key: `${rootName}/${x.key}`, url: x.url })),
            (i, total, msg) => send("progress", { step: "下载图片", current: i, total, message: msg })
          );
          for (const [k, v] of Object.entries(imgMap)) files[k] = v;
        }

        // 5) 重命名 mapping（仍输出 rename_map.csv）
        if (rename?.originals?.length) {
          send("progress", { step: "生成重命名", current: 0, total: 0, message: `原始文件数：${rename.originals.length}` });

          const tvFormat =
            rename.tvFormat ||
            `{{ title }}{% if year %} ({{ year }}){% endif %}/Season {{ season }}/{{ title }} - {{ season_episode }}{% if episode_title %} - {{ episode_title }}{% endif %}{{ fileExt }}`;
          const movieFormat =
            rename.movieFormat ||
            `{{ title }}{% if year %} ({{ year }}){% endif %}/{{ title }}{% if year %} ({{ year }}){% endif %}{{ fileExt }}`;

          const csvLines: string[] = ["original,new"];
          const preview: string[] = [];

          const epsSorted = [...episodes].sort(
            (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
          );
          let fallbackIdx = 0;

          for (const originalRaw of rename.originals) {
            const original = (originalRaw || "").trim();
            if (!original) continue;

            const { ext } = splitExt(original);

            const ctxBase: any = {
              title: series.title || "",
              en_title: "",
              original_title: series.originalTitle || "",
              year: series.year || "",
              tmdbid: (series.uniqueIds?.tmdb || "") as string,
              imdbid: (series.uniqueIds?.imdb || "") as string,
              original_name: original,
              fileExt: ext || "",
              customization: rename.customization || ""
            };

            let newPath = "";

            if (mediaType === "movie") {
              newPath = renderRenameTemplate(movieFormat, ctxBase);
            } else {
              const parsed = parseSeasonEpisodeFromName(original);

              let s: number;
              let e: number;
              let episodeTitle = "";
              let episodeDate = "";

              if (parsed.season !== null && parsed.episode !== null) {
                s = parsed.season;
                e = parsed.episode;
                const hit = epsSorted.find((x) => x.seasonNumber === s && x.episodeNumber === e);
                episodeTitle = hit?.title || "";
                episodeDate = hit?.aired || "";
              } else {
                const ep = epsSorted[fallbackIdx] || null;
                s = ep?.seasonNumber || 1;
                e = ep?.episodeNumber || (fallbackIdx + 1);
                episodeTitle = ep?.title || "";
                episodeDate = ep?.aired || "";
                fallbackIdx++;
              }

              const ctxTv = {
                ...ctxBase,
                season: s,
                episode: e,
                season_episode: seasonEpisode(s, e),
                episode_title: episodeTitle,
                episode_date: episodeDate,
                season_year: ""
              };

              newPath = renderRenameTemplate(tvFormat, ctxTv);
            }

            newPath = sanitizePathLike(newPath);
            if (!newPath) newPath = sanitizePathLike(original);

            csvLines.push(`${csvEscape(original)},${csvEscape(newPath)}`);
            preview.push(`${original}  ->  ${newPath}`);
          }

          files[`${rootName}/rename/rename_map.csv`] = textFile(csvLines.join("\n"));
          files[`${rootName}/rename/rename_preview.txt`] = textFile(preview.join("\n"));
        }

        // 6) 打包 zip + 存 R2 + 返回下载
        send("progress", { step: "打包", current: 0, total: 0, message: "生成 zip…" });
        const zip = makeZip(files);

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const key = `zips/${rootName}-${stamp}.zip`;

        if (!env.META_BUCKET) {
          throw new Error(
            "R2 未绑定：请在 Pages -> Settings -> Bindings 绑定 R2 Bucket 到变量名 META_BUCKET（Production 环境也要绑）。"
          );
        }

        await env.META_BUCKET.put(key, zip, { httpMetadata: { contentType: "application/zip" } });

        const downloadUrl = new URL("/api/download", new URL(context.request.url).origin);
        downloadUrl.searchParams.set("key", key);

        send("done", { downloadUrl: downloadUrl.toString() });
        controller.close();
      } catch (e: any) {
        fail(e?.message || String(e));
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  });
};

function encodeSSE(event: string, data: any) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function splitList(s: string): string[] {
  return (s || "")
    .split(/[,，/|]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mergeSeries(base: any, filled: any) {
  const out = { ...base };
  for (const k of ["title", "originalTitle", "year", "plot", "premiered"]) {
    if (!out[k] && filled?.[k]) out[k] = filled[k];
  }
  if (!Number.isFinite(out.rating) && Number.isFinite(filled?.rating)) out.rating = filled.rating;

  for (const k of ["genres", "studios", "actors"]) {
    if ((!out[k] || !out[k].length) && Array.isArray(filled?.[k])) out[k] = filled[k];
  }
  if (filled?.uniqueIds && typeof filled.uniqueIds === "object") {
    out.uniqueIds = { ...(out.uniqueIds || {}), ...filled.uniqueIds };
  }
  return out;
}

function csvEscape(s: string) {
  const v = String(s ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
