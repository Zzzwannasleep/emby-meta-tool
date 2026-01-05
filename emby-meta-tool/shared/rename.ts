// 轻量版 Jinja2：支持 {{ var }} 和 {% if var %}...{% endif %}
// 以及用 / 分隔多级目录（调用处负责把 / 当路径）
//
// 注意：这不是完整 jinja2，只做 MoviePilot 重命名 80% 常用功能。

function get(obj: any, key: string): any {
  if (!obj) return undefined;
  return obj[key];
}

function truthy(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

export function renderRenameTemplate(template: string, ctx: Record<string, any>): string {
  let out = template ?? "";

  // 处理 {% if var %} ... {% endif %}（不支持嵌套）
  out = out.replace(/{%\s*if\s+([a-zA-Z0-9_]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g, (_m, varName, body) => {
    const v = get(ctx, varName);
    return truthy(v) ? body : "";
  });

  // 处理 {{ var }}
  out = out.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, varName) => {
    const v = get(ctx, varName);
    return v === null || v === undefined ? "" : String(v);
  });

  // 清理重复空格
  out = out.replace(/[ \t]+/g, " ").replace(/ +\//g, "/").trim();

  return out;
}

export function sanitizePathLike(s: string): string {
  // 允许 / 做目录分隔；每段分别 sanitize
  const parts = (s || "").split("/").filter((p) => p.length > 0);
  const safeParts = parts.map((p) => p.replace(/[\\:*?"<>|]/g, "_").trim());
  return safeParts.join("/");
}

export function splitExt(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function seasonEpisode(season: number, episode: number) {
  return `S${pad2(season)}E${pad2(episode)}`;
}

/**
 * 从文件名里解析 season/episode
 * 支持：
 *  - S01E02 / s1e2 / S1.E2 / S01.E02
 *  - 1x02 / 01x02
 *  - 第1季第2集 / 第01季 第02集
 *  - 第2集 / EP02 / E02 / Episode 02（无季则 season=null）
 *  - [S01][E02] 这类也能命中
 */
export function parseSeasonEpisodeFromName(filename: string): { season: number | null; episode: number | null } {
  const s = (filename || "").toLowerCase();

  // 1) SxxEyy
  {
    const m = s.match(/s\s*0*(\d{1,3})\s*[ ._\-\[\(]*e\s*0*(\d{1,4})/i);
    if (m) return { season: toInt(m[1]), episode: toInt(m[2]) };
  }

  // 2) 1x02
  {
    const m = s.match(/(?:^|[ ._\-\[\(])0*(\d{1,3})\s*x\s*0*(\d{1,4})(?:$|[ ._\-\]\)])/i);
    if (m) return { season: toInt(m[1]), episode: toInt(m[2]) };
  }

  // 3) 第1季第2集 / 第1季 第2话
  {
    const m = s.match(/第\s*0*(\d{1,3})\s*季[\s\S]{0,8}?第\s*0*(\d{1,4})\s*(?:集|话)/i);
    if (m) return { season: toInt(m[1]), episode: toInt(m[2]) };
  }

  // 4) 只有“第2集/话”（无季）
  {
    const m = s.match(/第\s*0*(\d{1,4})\s*(?:集|话)/i);
    if (m) return { season: null, episode: toInt(m[1]) };
  }

  // 5) EP02 / E02 / Episode 02（无季）
  {
    const m = s.match(/(?:^|[ ._\-\[\(])(?:ep|e|episode)\s*0*(\d{1,4})(?:$|[ ._\-\]\)])/i);
    if (m) return { season: null, episode: toInt(m[1]) };
  }

  return { season: null, episode: null };
}

function toInt(x: string): number {
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : 0;
}
