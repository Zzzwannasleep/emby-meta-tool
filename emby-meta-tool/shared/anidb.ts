import type { Env } from "./types";

/**
 * AniDB 标题检索：
 * - 你在 R2 上传一个简化索引 JSON：[{ "aid": 1, "title": "..." , "syn": ["..."] }]
 * - Worker 读这个 JSON 做 contains 匹配（轻量，免费计划够用）
 */
export async function anidbSearchByIndex(env: Env, q: string) {
  const key = env.ANIDB_TITLE_INDEX_R2_KEY || "anidb/title-index.min.json";
  const obj = await env.META_BUCKET.get(key);
  if (!obj) throw new Error(`AniDB 标题索引不存在：R2/${key}。请先在 R2 网页上传索引文件。`);

  const text = await obj.text();
  const items = JSON.parse(text) as Array<{ aid: number; title: string; syn?: string[] }>;
  const kw = q.trim().toLowerCase();
  const hit = items
    .filter((it) => {
      const t = (it.title || "").toLowerCase();
      const syn = (it.syn || []).join(" ").toLowerCase();
      return t.includes(kw) || syn.includes(kw);
    })
    .slice(0, 20)
    .map((it) => ({
      source: "anidb",
      id: String(it.aid),
      title: it.title,
      year: "",
      subtitle: it.syn?.slice(0, 3).join(" / ") || "",
      poster: ""
    }));

  return hit;
}
