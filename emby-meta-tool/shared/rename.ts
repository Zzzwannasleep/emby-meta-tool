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

  // 处理 {% if var %} ... {% endif %}
  // 不支持嵌套 if（够用且更稳）
  out = out.replace(/{%\s*if\s+([a-zA-Z0-9_]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g, (_m, varName, body) => {
    const v = get(ctx, varName);
    return truthy(v) ? body : "";
  });

  // 处理 {{ var }}
  out = out.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, varName) => {
    const v = get(ctx, varName);
    return v === null || v === undefined ? "" : String(v);
  });

  // 清理重复空格（可选）
  out = out.replace(/[ \t]+/g, " ").replace(/ +\//g, "/").trim();

  return out;
}

export function sanitizePathLike(s: string): string {
  // 允许 / 做目录分隔，但要避免 Windows/非法字符
  // 将每段分别 sanitize
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
