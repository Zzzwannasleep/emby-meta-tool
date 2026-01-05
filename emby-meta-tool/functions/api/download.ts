import type { Env } from "../../shared/types";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  const url = new URL(context.request.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  const obj = await env.META_BUCKET.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeName(key.split("/").pop() || "metadata.zip")}"`
    }
  });
};

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9._()-]+/g, "_");
}
