import type { Env } from "../../shared/types";
import { listRemote, UploadTarget, isTargetEnabled } from "../../shared/uploaders";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  if (context.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await context.request.json<any>().catch(() => null);
  if (!body || !body.target) return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });

  const target = String(body.target) as UploadTarget;
  const path = (body.path || "/") as string;

  if (!isTargetEnabled(env, target)) {
    return new Response(JSON.stringify({ error: "target disabled" }), { status: 400 });
  }

  try {
    const data = await listRemote(env, target, path);
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
};
