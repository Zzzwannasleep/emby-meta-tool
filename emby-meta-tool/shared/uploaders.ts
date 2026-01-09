import type { Env } from "./types";

export type UploadTarget = "openlist" | "rclone";

export type UploadListItem = { name: string; type: "dir" | "file" };

type ProgressFn = (current: number, total: number, path: string) => void;

const enum Errors {
  NotEnabled = "UPLOAD_TARGET_DISABLED"
}

function normalizeBase(url: string) {
  return url.replace(/\/+$/, "");
}

function joinPath(...parts: Array<string | undefined | null>) {
  const filtered = parts
    .filter((p) => typeof p === "string")
    .map((p) => (p || "").replace(/\\/g, "/"))
    .map((p) => p.replace(/^\/+/, "").replace(/\/+$/, ""));
  return "/" + filtered.filter(Boolean).join("/");
}

function rcAuthHeaders(env: Env) {
  if (env.RCLONE_RC_USER) {
    const raw = `${env.RCLONE_RC_USER}:${env.RCLONE_RC_PASS || ""}`;
    return { Authorization: `Basic ${btoa(raw)}` };
  }
  return {};
}

async function getOpenListToken(env: Env) {
  if (env.OPENLIST_TOKEN) return env.OPENLIST_TOKEN;
  if (env.OPENLIST_USERNAME && env.OPENLIST_PASSWORD) {
    const base = env.OPENLIST_BASE ? normalizeBase(env.OPENLIST_BASE) : "";
    if (!base) throw new Error("OPENLIST_BASE 缺失");
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: env.OPENLIST_USERNAME, password: env.OPENLIST_PASSWORD })
    });
    if (!res.ok) throw new Error(`OpenList 登录失败 ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data?.token) return data.token as string;
  }
  throw new Error("OpenList token/账号未配置");
}

export function isTargetEnabled(env: Env, target: UploadTarget) {
  if (target === "openlist") {
    return !!env.OPENLIST_ENABLED && !!(env.OPENLIST_TOKEN || (env.OPENLIST_USERNAME && env.OPENLIST_PASSWORD)) && !!env.OPENLIST_BASE;
  }
  if (target === "rclone") {
    return !!env.RCLONE_ENABLED && !!env.RCLONE_RC_URL && !!env.RCLONE_FS;
  }
  return false;
}

export function getUploadConfig(env: Env) {
  return {
    openlist: {
      enabled: isTargetEnabled(env, "openlist"),
      base: env.OPENLIST_BASE || ""
    },
    rclone: {
      enabled: isTargetEnabled(env, "rclone"),
      baseDir: env.RCLONE_BASE_DIR || "",
      rc: env.RCLONE_RC_URL || ""
    }
  };
}

export async function listRemote(env: Env, target: UploadTarget, path = "/"): Promise<{ path: string; items: UploadListItem[] }> {
  if (!isTargetEnabled(env, target)) throw new Error(Errors.NotEnabled);
  const cleanPath = joinPath(path);

  if (target === "openlist") {
    const token = await getOpenListToken(env);
    const base = normalizeBase(env.OPENLIST_BASE || "");
    const res = await fetch(`${base}/api/fs/list?path=${encodeURIComponent(cleanPath)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`OpenList 列表失败 ${res.status}`);
    const data = await res.json().catch(() => ({}));
    const raw = (data?.items || data?.data || data?.list || data?.files || []) as any[];
    const items: UploadListItem[] = Array.isArray(raw)
      ? raw
          .map((x) => ({
            name: x.name || x.Path || x.path || x.id || "",
            type: x.type === "dir" || x.Type === "dir" || x.is_dir ? "dir" : x.is_dir === undefined && x.IsDir === true ? "dir" : "file"
          }))
          .filter((x) => x.name)
      : [];
    return { path: cleanPath, items };
  }

  // rclone
  const rc = normalizeBase(env.RCLONE_RC_URL || "");
  const payload = {
    fs: env.RCLONE_FS,
    remote: joinPath(env.RCLONE_BASE_DIR || "", cleanPath).replace(/^\/+/, "")
  };
  const res = await fetch(`${rc}/operations/list`, {
    method: "POST",
    headers: { "content-type": "application/json", ...rcAuthHeaders(env) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`rclone 列表失败 ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const raw = (data?.list || data?.items || data?.Entries || data?.entries) as any[];
  const items: UploadListItem[] = Array.isArray(raw)
    ? raw
        .map((x) => ({
          name: x.Name || x.name || x.Path || x.path || "",
          type: x.IsDir || x.isDir || x.IsDirectory ? "dir" : x.is_dir ? "dir" : "file"
        }))
        .filter((x) => x.name)
    : [];
  return { path: cleanPath, items };
}

export async function uploadFileMap(
  env: Env,
  target: UploadTarget,
  basePath: string,
  files: Record<string, Uint8Array>,
  onProgress?: ProgressFn
) {
  if (!isTargetEnabled(env, target)) throw new Error(Errors.NotEnabled);
  const entries = Object.entries(files);
  const total = entries.length;
  if (!total) return;

  if (target === "openlist") {
    const token = await getOpenListToken(env);
    const base = normalizeBase(env.OPENLIST_BASE || "");

    for (let i = 0; i < entries.length; i++) {
      const [rel, buf] = entries[i];
      const remotePath = joinPath(basePath, rel);
      onProgress?.(i + 1, total, remotePath);
      const res = await fetch(`${base}/api/fs/put`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "File-Path": remotePath,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(buf.length)
        },
        body: buf
      });
      if (!res.ok) throw new Error(`OpenList 上传失败 ${res.status}: ${remotePath}`);
    }
    return;
  }

  // rclone
  const rc = normalizeBase(env.RCLONE_RC_URL || "");
  for (let i = 0; i < entries.length; i++) {
    const [rel, buf] = entries[i];
    const remotePath = joinPath(env.RCLONE_BASE_DIR || "", basePath, rel);
    onProgress?.(i + 1, total, remotePath);

    const fd = new FormData();
    fd.set("fs", env.RCLONE_FS || "");
    fd.set("remote", remotePath.replace(/^\/+/, ""));
    fd.set("file", new Blob([buf], { type: "application/octet-stream" }), rel.split("/").pop() || "file.bin");

    const res = await fetch(`${rc}/operations/uploadfile`, {
      method: "POST",
      headers: rcAuthHeaders(env),
      body: fd
    });
    if (!res.ok) throw new Error(`rclone 上传失败 ${res.status}: ${remotePath}`);
  }
}
