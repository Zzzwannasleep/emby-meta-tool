import type { Env } from "../../shared/types";
import { getUploadConfig } from "../../shared/uploaders";

export const onRequest = async (context: any) => {
  const env = context.env as Env;
  const cfg = getUploadConfig(env);
  return new Response(JSON.stringify(cfg), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
