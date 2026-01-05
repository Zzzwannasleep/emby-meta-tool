/* eslint-disable @typescript-eslint/no-explicit-any */

type MediaType = "tv" | "movie" | "anime";
type SourceType = "tmdb" | "bangumi" | "anidb" | "manual";

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function isLikelyV4Token(key: string) {
  // v4 read token 常见是 JWT-like：以 eyJ 开头，且包含 '.' 分段
  return key.startsWith("eyJ") || key.includes(".");
}

async function tmdbFetch(path: string, params: Record<string, string>, env: any) {
  const key = (env?.TMDB_API_KEY || "").trim();
  if (!key) {
    throw new Error("Missing TMDB_API_KEY in Cloudflare Pages Environment Variables (Production).");
  }

  const url = new URL(`https://api.themoviedb.org/3/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length > 0) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { accept: "application/json" };

  if (isLikelyV4Token(key)) {
    headers.authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }

  const res = await fetch(url.toString(), { headers });

  // 关键：不要吞错
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status} ${res.statusText}: ${text || "(empty body)"}`);
  }

  return res.json();
}

function pickYear(x: any) {
  const d = x?.first_air_date || x?.release_date || "";
  return typeof d === "string" && d.length >= 4 ? d.slice(0, 4) : "";
}

function mapTmdbItem(x: any, mediaType: MediaType) {
  return {
    id: String(x.id),
    title: x.name || x.title || "",
    originalTitle: x.original_name || x.original_title || "",
    year: pickYear(x),
    type: mediaType,
    poster: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : ""
  };
}

export async function onRequestPost(context: any) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const source: SourceType = body?.source || "tmdb";
    const mediaType: MediaType = body?.mediaType || "tv";
    const lang = (body?.lang || "zh-CN").trim();

    // manual / other source：先不误伤（你需要我可以继续补齐 bangumi/anidb）
    if (source !== "tmdb") {
      return json({
        items: [],
        note: `source=${source} search is not implemented in this version of search.ts`
      });
    }

    const id = (body?.id || "").toString().trim();
    const query = (body?.query || "").toString().trim();

    if (!id && !query) {
      return json({ items: [], error: "Missing query or id" }, 400);
    }

    // TMDB 支持：tv / movie
    const tmdbType = mediaType === "movie" ? "movie" : "tv";

    // 直接 ID
    if (id) {
      const item = await tmdbFetch(`${tmdbType}/${encodeURIComponent(id)}`, { language: lang }, context.env);
      return json({ items: [mapTmdbItem(item, mediaType)] });
    }

    // 关键词搜索
    const data = await tmdbFetch(`search/${tmdbType}`, { query, language: lang, include_adult: "false", page: "1" }, context.env);
    const results = Array.isArray(data?.results) ? data.results : [];
    const items = results.map((x: any) => mapTmdbItem(x, mediaType));

    return json({ items });
  } catch (e: any) {
    // 关键：错误不要吞，直接抛给前端看
    return json({ error: e?.message || String(e) }, 500);
  }
}
