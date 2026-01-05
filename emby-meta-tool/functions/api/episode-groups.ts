/* eslint-disable @typescript-eslint/no-explicit-any */

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
  return key.startsWith("eyJ") || key.includes(".");
}

async function tmdbFetch(path: string, params: Record<string, string>, env: any) {
  const key = (env?.TMDB_API_KEY || "").trim();
  if (!key) {
    throw new Error("Missing TMDB_API_KEY in Cloudflare Pages Environment Variables (Production).");
  }

  const url = new URL(`https://api.themoviedb.org/3/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };

  if (isLikelyV4Token(key)) {
    headers.authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status} ${res.statusText}: ${text || "(empty body)"}`);
  }

  return res.json();
}

export async function onRequestPost(context: any) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const tvId = (body?.tmdbTvId || "").toString().trim();
    const lang = (body?.lang || "zh-CN").trim();

    if (!tvId) {
      return json({ error: "Missing tmdbTvId" }, 400);
    }

    const data = await tmdbFetch(
      `tv/${encodeURIComponent(tvId)}/episode_groups`,
      { language: lang },
      context.env
    );

    const groups = Array.isArray(data?.results) ? data.results : [];

    const items = groups.map((g: any) => ({
      id: String(g.id),
      name: g.name || "",
      description: g.description || "",
      episode_count: g.episode_count,
      group_count: g.group_count
    }));

    return json({ items });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}
