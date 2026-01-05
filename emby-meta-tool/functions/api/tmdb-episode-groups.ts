import type { Env } from "../../shared/types";
import { tmdbListEpisodeGroups } from "../../shared/tmdb";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  const url = new URL(context.request.url);
  const tvId = url.searchParams.get("tvId");

  if (!tvId) return json({ error: "缺少 tvId" }, 400);

  try {
    const data = await tmdbListEpisodeGroups(env, tvId);
    const groups = (data?.results || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description || ""
    }));
    return json({ groups });
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
