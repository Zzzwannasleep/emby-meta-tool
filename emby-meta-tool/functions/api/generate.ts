import type { Env } from "../../shared/types";
import { aiFillMissing } from "../../shared/ai";
import { makeZip, textFile } from "../../shared/zip";
import {
  buildEpisodeNfo,
  buildSeasonNfo,
  buildTvshowNfo,
  episodeNfoName,
  seasonFolderName,
  seriesRootFolderName
} from "../../shared/emby";
import { downloadImagesToMap, tmdbGetDetails, tmdbGetEpisodeGroup, tmdbGetTvSeason } from "../../shared/tmdb";
import { bangumiGetEpisodes, bangumiGetSubject } from "../../shared/bangumi";

export const onRequest = async (context: any) => {
  const env = context.env as Env;

  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const req = await context.request.json<any>().catch(() => null);
  if (!req) return new Response("Bad JSON", { status: 400 });

  const source = (req.source || "tmdb") as "tmdb" | "bangumi" | "anidb";
  const mediaType = (req.mediaType || "tv") as "tv" | "movie" | "anime";
  const lang = (req.lang || "zh-CN") as string;
  const id = (req.id || null) as string | null;
  const episodeGroupId = (req.episodeGroupId || null) as string | null;
  const useAI = !!req.useAI;
  const manual = req.manual || {};

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(encodeSSE(event, data));
      };

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
        let episodes: Array<{ seasonNumber: number; episodeNumber: number; title: string; plot?: string; aired?: string }> = [];
        let imageQueue: Array<{ key: string; url: string }> = [];

        if (source === "tmdb") {
          if (!id) throw new Error("TMDB 必须提供 ID（TV/Movie ID）或先检索选择。");
          const tm = mediaType === "movie" ? "movie" : "tv";
          send("progress", { step: "拉取 TMDB 详情", current: 0, total: 0, message: `TMDB /${tm}/${id}` });

          const detail = await tmdbGetDetails(env, tm, id, lang);

          // series info
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

          // genres / studios / actors
          series.genres = (series.genres?.length ? series.genres : (detail.genres || []).map((g: any) => g.name)).filter(Boolean);
          series.studios = (series.studios?.length ? series.studios : (detail.networks || detail.production_companies || []).map((x: any) => x.name)).filter(Boolean);
          if (!series.actors?.length) {
            const cast = detail.credits?.cast || [];
            series.actors = cast.slice(0, 20).map((c: any) => c.name).filter(Boolean);
          }

          // images (poster/fanart/landscape)
          if (detail.poster_path) imageQueue.push({ key: "poster.jpg", url: `https://image.tmdb.org/t/p/original${detail.poster_path}` });
          const backdrops = (detail.images?.backdrops || []).slice(0, 1);
          if (backdrops[0]?.file_path) imageQueue.push({ key: "fanart.jpg", url: `https://image.tmdb.org/t/p/original${backdrops[0].file_path}` });
          const posters = (detail.images?.posters || []).slice(0, 1);
          if (!detail.poster_path && posters[0]?.file_path) imageQueue.push({ key: "poster.jpg", url: `https://image.tmdb.org/t/p/original${posters[0].file_path}` });

          // TV episodes / seasons
          if (tm === "tv") {
            if (episodeGroupId) {
              send("progress", { step: "拉取剧集组", current: 0, total: 0, message: `TMDB episode_group ${episodeGroupId}` });
              const g = await tmdbGetEpisodeGroup(env, episodeGroupId, lang);

              // group 的结构：groups[] => episodes[] 映射到 season/episode
              // 这里按 group 的顺序重新编号：第1组为 Season 1，第2组为 Season 2...
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
              if (!episodes.length) {
                send("progress", { step: "提示", current: 0, total: 0, message: "该剧集组未返回可用分组/集信息，将回退到默认季集。" });
              }
            }

            // 回退：按默认 season/episode
            if (!episodes.length) {
              const seasonList = (detail.seasons || []).filter((s: any) => typeof s.season_number === "number" && s.season_number >= 0);
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
        }

        if (source === "bangumi") {
          if (!id) throw new Error("Bangumi 必须提供 subject id 或先检索选择。");
          send("progress", { step: "拉取 Bangumi 详情", current: 0, total: 0, message: `Bangumi /subject/${id}` });
          const sub = await bangumiGetSubject(env, id);

          series.title = series.title || sub.name_cn || sub.name || "";
          series.originalTitle = series.originalTitle || sub.name || "";
          series.plot = series.plot || sub.summary || "";
          series.uniqueIds = { ...(series.uniqueIds || {}), bangumi: String(sub.id) };
          if (sub.images?.large) imageQueue.push({ key: "poster.jpg", url: sub.images.large });

          // episodes
          send("progress", { step: "拉取 Bangumi 章节", current: 0, total: 0, message: `Bangumi /subject/${id}/ep` });
          const eps = await bangumiGetEpisodes(env, id);
          const list = eps?.data || eps?.eps || [];
          // Bangumi eps: sort by sort
          const normal = list.filter((x: any) => x.type === 0 || x.type === 1).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));

          // Bangumi 不天然有 season，这里按 Emby TV 结构输出：统一 Season 1
          seasons = [{ seasonNumber: 1, title: "Season 1", plot: "" }];
          episodes = normal.map((e: any, idx: number) => ({
            seasonNumber: 1,
            episodeNumber: Number.isFinite(e.sort) ? Number(e.sort) : idx + 1,
            title: e.name_cn || e.name || `Episode ${idx + 1}`,
            plot: e.desc || "",
            aired: e.airdate || ""
          }));
        }

        if (source === "anidb") {
          if (!id) throw new Error("AniDB 必须提供 AID 或先用索引检索选中。");
          // AniDB 这里不强行拉取 TCP API（复杂且限制多），以“手工/AI补全 + AID 写入 uniqueid”为主
          send("progress", { step: "AniDB 处理", current: 0, total: 0, message: `AniDB AID=${id}（建议配合手工填写或AI补全）` });
          series.uniqueIds = { ...(series.uniqueIds || {}), anidb: String(id) };

          // 默认按单季输出（你也可以手动改/AI补全）
          if (!seasons.length) seasons = [{ seasonNumber: 1, title: "Season 1", plot: "" }];
          if (!episodes.length) {
            episodes = [{ seasonNumber: 1, episodeNumber: 1, title: series.title || "Episode 1", plot: "", aired: "" }];
          }
        }

        // 2) AI 补全缺失字段（可选）
        if (useAI) {
          send("progress", { step: "AI 补全", current: 0, total: 0, message: "调用 AI 补全缺失字段…" });
          const filled = await aiFillMissing(env, series);
          series = mergeSeries(series, filled);
          send("progress", { step: "AI 补全", current: 0, total: 0, message: "AI 补全完成" });
        }

        // 3) 生成 Emby 目录结构文件
        const rootName = seriesRootFolderName(series.title || "Unknown", series.year || "");
        send("progress", { step: "生成 NFO", current: 0, total: 0, message: `根目录：${rootName}` });

        const files: Record<string, Uint8Array> = {};
        files[`${rootName}/tvshow.nfo`] = textFile(buildTvshowNfo(series));

        // seasons + episodes
        // 注意：Season 0（specials）也允许，但这里按现有数据输出
        const seasonSet = new Set<number>();
        for (const s of seasons) seasonSet.add(s.seasonNumber);
        for (const e of episodes) seasonSet.add(e.seasonNumber);

        const seasonNums = Array.from(seasonSet).sort((a, b) => a - b);
        for (const sn of seasonNums) {
          const folder = `${rootName}/${seasonFolderName(sn)}`;
          const sObj = seasons.find((x) => x.seasonNumber === sn) || { seasonNumber: sn, title: `Season ${sn}`, plot: "" };
          files[`${folder}/season.nfo`] = textFile(buildSeasonNfo(sObj));

          const eps = episodes.filter((x) => x.seasonNumber === sn).sort((a, b) => a.episodeNumber - b.episodeNumber);
          for (const ep of eps) {
            files[`${folder}/${episodeNfoName(sn, ep.episodeNumber)}`] = textFile(buildEpisodeNfo(ep));
          }
        }

        // 4) 下载图片（带流控）
        if (imageQueue.length) {
          send("progress", { step: "下载图片", current: 0, total: imageQueue.length, message: `共 ${imageQueue.length} 张` });
          const imgMap = await downloadImagesToMap(env, imageQueue.map((x) => ({ key: `${rootName}/${x.key}`, url: x.url })), (i, total, msg) => {
            send("progress", { step: "下载图片", current: i, total, message: msg });
          });
          for (const [k, v] of Object.entries(imgMap)) files[k] = v;
        }

        // 5) 打 zip + 存 R2 + 返回下载
        send("progress", { step: "打包", current: 0, total: 0, message: "生成 zip…" });
        const zip = makeZip(files);

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const key = `zips/${rootName}-${stamp}.zip`;
        await env.META_BUCKET.put(key, zip, {
          httpMetadata: { contentType: "application/zip" }
        });

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
      "connection": "keep-alive"
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
