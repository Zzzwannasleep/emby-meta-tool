import type { Env } from "../../shared/types";
import { tmdbSearch } from "../../shared/tmdb";
import { bangumiSearch } from "../../shared/bangumi";
import { anidbSearchByIndex } from "../../shared/anidb";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  const url = new URL(context.request.url);

  const source = (url.searchParams.get("source") || "tmdb").toLowerCase();
  const mediaType = (url.searchParams.get("mediaType") || "tv") as "tv" | "movie" | "anime";
  const q = url.searchParams.get("q") || "";
  const id = url.searchParams.get("id") || "";
  const lang = url.searchParams.get("lang") || "zh-CN";

  try {
    if (id) {
      // ID 输入场景：前端直接把“选中项”处理为 selected，不一定需要这里返回详情
      // 这里返回一个“伪结果”，让 UI 可选中
      return json({
        items: [
          {
            source,
            id,
            title: `${source.toUpperCase()} #${id}`,
            year: "",
            subtitle: "已直接输入 ID（生成时会拉取详情/或用手工/AI补全）",
            poster: ""
          }
        ]
      });
    }

    if (!q.trim()) return json({ items: [] });

    if (source === "tmdb") {
      const m = mediaType === "movie" ? "movie" : "tv";
      const items = await tmdbSearch(env, m, q, lang);
      return json({ items });
    }

    if (source === "bangumi") {
      const items = await bangumiSearch(env, q);
      return json({ items });
    }

    if (source === "anidb") {
      const items = await anidbSearchByIndex(env, q);
      return json({ items });
    }

    return json({ error: "不支持的数据源" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
