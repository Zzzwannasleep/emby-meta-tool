import type { Env } from "./types";

function base(env: Env) {
  return env.BANGUMI_API_BASE || "https://api.bgm.tv";
}

async function bgmFetch(env: Env, path: string) {
  const url = base(env) + path;
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "emby-meta-tool/1.0 (Cloudflare Workers)"
    }
  });
  if (!res.ok) throw new Error(`Bangumi 请求失败 ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json<any>();
}

// 为了简单与兼容，这里用 legacy search：/search/subject/{keywords}?type=2
export async function bangumiSearch(env: Env, q: string) {
  const path = `/search/subject/${encodeURIComponent(q)}?type=2&responseGroup=large&max_results=20`;
  const data = await bgmFetch(env, path);
  const list = data.list || [];
  return list.map((it: any) => ({
    source: "bangumi",
    id: String(it.id),
    title: it.name_cn || it.name || "Untitled",
    year: "",
    subtitle: it.summary || "",
    poster: it.images?.medium || it.images?.large || ""
  }));
}

export async function bangumiGetSubject(env: Env, id: string) {
  return bgmFetch(env, `/subject/${encodeURIComponent(id)}?responseGroup=large`);
}

export async function bangumiGetEpisodes(env: Env, id: string) {
  // eps list
  return bgmFetch(env, `/subject/${encodeURIComponent(id)}/ep?offset=0&limit=1000`);
}
