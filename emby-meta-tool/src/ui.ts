/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * UI（Material Web / Material v3 风格）
 * - 搜索 / 选择条目
 * - TMDB Episode Groups 列表展示与选择
 * - 一键生成并打包下载（SSE 进度）
 * - 重命名（MoviePilot 模板）+ NFO 命名模式（standard / same_as_media / both）
 * - 预览界面：展示媒体重命名路径 + NFO 输出文件名预览
 * - ✅ 新增：🪄 自动补全 originals（给一集，解析完剩下的）
 *
 * 依赖后端接口：
 * - POST /api/search
 * - POST /api/episode-groups
 * - POST /api/generate  （SSE：progress/done/error）
 * - POST /api/preview
 */

type MediaType = "tv" | "movie" | "anime";
type SourceType = "tmdb" | "bangumi" | "anidb" | "manual";
type NfoNameMode = "standard" | "same_as_media" | "both";

type SearchItem = {
  id: string;
  title: string;
  originalTitle?: string;
  year?: string;
  type?: MediaType;
  poster?: string;
  extra?: any;
};

type EpisodeGroupItem = {
  id: string;
  name: string;
  description?: string;
  episode_count?: number;
  group_count?: number;
};

type ManualStructure = {
  seasons: number;
  episodesPerSeason?: number;
  seasonEpisodeMapText?: string; // "1:12,2:10"
  episodeTitleTemplate?: string;
  seasonPlotsText?: string;
  episodePlotsText?: string;
};

type RenameConfig = {
  tvFormat: string;
  movieFormat: string;
  customization: string;
  originalsText: string;
  nfoNameMode: NfoNameMode;
};

type ManualMeta = {
  title: string;
  originalTitle: string;
  year: string;
  plot: string;
  premiered: string;
  rating: string;
  genres: string;
  studios: string;
  actors: string;
};

type ManualEpisodeMeta = {
  enabled: boolean;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  plot: string;
  aired: string;
};

type State = {
  source: SourceType;
  mediaType: MediaType;
  lang: string;

  query: string;
  idInput: string;

  // 选择结果
  selected: SearchItem | null;

  // episode group
  episodeGroups: EpisodeGroupItem[];
  episodeGroupId: string;

  // AI
  useAI: boolean;

  // manual
  manual: ManualMeta;
  manualStructure: ManualStructure;
  manualEpisode: ManualEpisodeMeta;

  // rename
  rename: RenameConfig;

  // UI
  busy: boolean;
  status: string;
  logs: string[];
};

const state: State = {
  source: "tmdb",
  mediaType: "tv",
  lang: "zh-CN",

  query: "",
  idInput: "",

  selected: null,

  episodeGroups: [],
  episodeGroupId: "",

  useAI: false,

  manual: {
    title: "",
    originalTitle: "",
    year: "",
    plot: "",
    premiered: "",
    rating: "",
    genres: "",
    studios: "",
    actors: ""
  },

  manualStructure: {
    seasons: 1,
    episodesPerSeason: 12,
    seasonEpisodeMapText: "",
    episodeTitleTemplate: "Episode {{ episode }}",
    seasonPlotsText: "",
    episodePlotsText: ""
  },

  manualEpisode: {
    enabled: false,
    seasonNumber: 1,
    episodeNumber: 1,
    title: "",
    plot: "",
    aired: ""
  },

  rename: {
    tvFormat:
      "{{ title }}{% if year %} ({{ year }}){% endif %}/Season {{ season }}/{{ title }} - {{ season_episode }}{% if episode_title %} - {{ episode_title }}{% endif %}{{ fileExt }}",
    movieFormat:
      "{{ title }}{% if year %} ({{ year }}){% endif %}/{{ title }}{% if year %} ({{ year }}){% endif %}{{ fileExt }}",
    customization: "",
    originalsText: "",
    nfoNameMode: "both"
  },

  busy: false,
  status: "",
  logs: []
};

function $(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function escapeHtml(s: string) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setBusy(v: boolean, status?: string) {
  state.busy = v;
  if (typeof status === "string") state.status = status;

  const btn = $("btnGenerate") as HTMLButtonElement;
  (btn as any).disabled = v;

  const btnPrev = $("btnPreview") as HTMLButtonElement;
  (btnPrev as any).disabled = v;

  const btnAuto = document.getElementById("btnAutoFillOriginals") as HTMLButtonElement | null;
  if (btnAuto) (btnAuto as any).disabled = v;

  const btnSearch = $("btnSearch") as HTMLButtonElement;
  (btnSearch as any).disabled = v;

  const btnGroups = $("btnEpisodeGroups") as HTMLButtonElement;
  (btnGroups as any).disabled = v;

  renderStatus();
}

function log(line: string) {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (state.logs.length > 200) state.logs.length = 200;
  renderLogs();
}

function renderStatus() {
  const el = $("status");
  el.textContent = state.status || (state.busy ? "处理中…" : "");
}

function renderLogs() {
  const el = $("logs");
  el.textContent = state.logs.join("\n");
}

function parseSeasonMap(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const s = (text || "").trim();
  if (!s) return out;
  for (const seg of s.split(",")) {
    const t = seg.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) continue;
    out[m[1]] = Math.max(1, parseInt(m[2], 10));
  }
  return out;
}

function parseSeasonPlotMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (text || "").split("\n");
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function parseEpisodePlotMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (text || "").split("\n");
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^S?0*(\d+)[xXeE-]0*(\d+)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const key = `${parseInt(m[1], 10)}-${parseInt(m[2], 10)}`;
    out[key] = m[3].trim();
  }
  return out;
}

function normalizeManualEpisode() {
  if (!state.manualEpisode.enabled) return null;
  const seasonNumber = Number(state.manualEpisode.seasonNumber || 0);
  const episodeNumber = Number(state.manualEpisode.episodeNumber || 0);
  if (!seasonNumber || !episodeNumber) return null;

  return {
    seasonNumber,
    episodeNumber,
    title: state.manualEpisode.title || "",
    plot: state.manualEpisode.plot || "",
    aired: state.manualEpisode.aired || ""
  };
}

function getOriginalsList(): string[] {
  return (state.rename.originalsText || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildEpisodesFromManualStructure() {
  // 用于 preview：我们只需要 season/episode 列表（不强依赖真实标题）
  const manualEp = normalizeManualEpisode();
  if (manualEp) {
    return [{ seasonNumber: manualEp.seasonNumber, episodeNumber: manualEp.episodeNumber, title: manualEp.title || "" }];
  }

  const seasons = Math.max(1, Number(state.manualStructure.seasons || 1));
  const per = state.manualStructure.episodesPerSeason ? Math.max(1, Number(state.manualStructure.episodesPerSeason)) : 1;
  const map = parseSeasonMap(state.manualStructure.seasonEpisodeMapText || "");
  const eps: Array<{ seasonNumber: number; episodeNumber: number; title?: string }> = [];

  for (let s = 1; s <= seasons; s++) {
    const cnt = map[String(s)] || per;
    for (let e = 1; e <= cnt; e++) {
      eps.push({ seasonNumber: s, episodeNumber: e, title: "" });
    }
  }
  return eps;
}

function getSeriesForRequest() {
  // 以“手动标题优先”，其次用 selected
  const title = state.manual.title || state.selected?.title || "";
  const year = state.manual.year || state.selected?.year || "";
  const originalTitle = state.manual.originalTitle || state.selected?.originalTitle || "";
  return { title, year, originalTitle };
}

/* =========================
   ✅ 自动补全 originals：给一集，解析剩下的
========================= */

function splitExt(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function detectSeEp(s: string): { season: number | null; episode: number | null } {
  const lower = (s || "").toLowerCase();

  // 1) SxxEyy / s1e2 / S01.E02
  let m = lower.match(/s\s*0*(\d{1,3})\s*[ ._\-\[\(]*e\s*0*(\d{1,4})/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

  // 2) 1x02
  m = lower.match(/(?:^|[ ._\-\[\(])0*(\d{1,3})\s*x\s*0*(\d{1,4})(?:$|[ ._\-\]\)])/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

  // 3) 第1季第2集/话
  m = lower.match(/第\s*0*(\d{1,3})\s*季[\s\S]{0,8}?第\s*0*(\d{1,4})\s*(?:集|话)/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

  // 4) 第2集/话（无季）
  m = lower.match(/第\s*0*(\d{1,4})\s*(?:集|话)/i);
  if (m) return { season: null, episode: parseInt(m[1], 10) };

  // 5) EP02/E02/Episode 02（无季）
  m = lower.match(/(?:^|[ ._\-\[\(])(?:ep|e|episode)\s*0*(\d{1,4})(?:$|[ ._\-\]\)])/i);
  if (m) return { season: null, episode: parseInt(m[1], 10) };

  return { season: null, episode: null };
}

function replaceSeEpInName(originalBase: string, season: number | null, episode: number) {
  const s = originalBase;

  // 优先替换已存在的模式，尽量保持原本风格
  if (/s\s*0*\d+\s*[ ._\-\[\(]*e\s*0*\d+/i.test(s)) {
    return s.replace(/s\s*0*\d+\s*[ ._\-\[\(]*e\s*0*\d+/i, `S${pad2(season ?? 1)}E${pad2(episode)}`);
  }

  if (/\b0*\d+\s*x\s*0*\d+\b/i.test(s)) {
    return s.replace(/\b0*\d+\s*x\s*0*\d+\b/i, `${season ?? 1}x${pad2(episode)}`);
  }

  if (/第\s*0*\d+\s*(集|话)/i.test(s)) {
    // 统一成 “第 X 集”
    return s.replace(/第\s*0*\d+\s*(集|话)/i, `第 ${episode} 集`);
  }

  if (/\b(?:ep|e|episode)\s*0*\d+\b/i.test(s)) {
    return s.replace(/\b(?:ep|e|episode)\s*0*\d+\b/i, `E${pad2(episode)}`);
  }

  // 都没命中：追加
  return `${s} - S${pad2(season ?? 1)}E${pad2(episode)}`;
}

function autoFillOriginalsFromFirstLine(): string {
  const lines = getOriginalsList();
  if (!lines.length) throw new Error("请先在“原始文件名列表”里填一行样例。");

  const sample = lines[0];
  const { base, ext } = splitExt(sample);

  const se = detectSeEp(base);
  const season = se.season ?? 1;
  const startEp = se.episode ?? 1;

  // 生成多少集：优先使用你手动结构（seasonEpisodeMapText），否则 epsPerSeason
  const seasonMap = parseSeasonMap(state.manualStructure.seasonEpisodeMapText || "");
  const per = Math.max(1, Number(state.manualStructure.episodesPerSeason || 1));
  const count = seasonMap[String(season)] || per;

  if (!Number.isFinite(count) || count <= 0) throw new Error("季/集结构不正确：请先填写每季集数或映射。");

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const ep = startEp + i;
    out.push(replaceSeEpInName(base, season, ep) + ext);
  }
  return out.join("\n");
}

/** ---------------------------
 * API 调用（如参数不一致，只需改这 2-3 个函数）
 * --------------------------*/

async function apiSearch(): Promise<SearchItem[]> {
  // 你仓库里的 /api/search 若参数不同，改这里即可
  const payload: any = {
    source: state.source,
    mediaType: state.mediaType,
    lang: state.lang
  };

  // 支持 “直接输入 ID”
  const id = (state.idInput || "").trim();
  const q = (state.query || "").trim();

  if (id) payload.id = id;
  if (q) payload.query = q;

  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `search failed: ${res.status}`);

  // 允许后端返回 { items: [...] } 或直接 [...]
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) return [];
  return items.map((x: any) => ({
    id: String(x.id),
    title: x.title || x.name || "",
    originalTitle: x.originalTitle || x.original_name || x.original_title || "",
    year: x.year || (x.first_air_date || x.release_date || "").slice(0, 4) || "",
    type: x.type || state.mediaType,
    poster: x.poster || x.poster_path || "",
    extra: x
  }));
}

async function apiEpisodeGroups(): Promise<EpisodeGroupItem[]> {
  // 仅 TMDB TV 有意义
  if (state.source !== "tmdb") return [];
  if (state.mediaType !== "tv") return [];

  const selectedId = state.selected?.id || (state.idInput || "").trim();
  if (!selectedId) throw new Error("请先选择一个 TMDB TV 条目。");

  const payload: any = {
    tmdbTvId: selectedId,
    lang: state.lang
  };

  const res = await fetch("/api/episode-groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `episode-groups failed: ${res.status}`);

  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) return [];

  return items.map((x: any) => ({
    id: String(x.id),
    name: x.name || "",
    description: x.description || "",
    episode_count: x.episode_count,
    group_count: x.group_count
  }));
}

async function apiPreview() {
  const originals = getOriginalsList();
  const series = getSeriesForRequest();
  const episodes = buildEpisodesFromManualStructure();

  const payload: any = {
    mediaType: state.mediaType,
    series,
    episodes,
    rename: {
      tvFormat: state.rename.tvFormat,
      movieFormat: state.rename.movieFormat,
      customization: state.rename.customization,
      originals,
      nfoNameMode: state.rename.nfoNameMode
    }
  };

  const res = await fetch("/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `preview failed: ${res.status}`);

  return data;
}

function buildGeneratePayload() {
  // 后端 generate.ts 预期字段（你现在 generate.ts 如果名字不同，改这里）
  const manualEp = normalizeManualEpisode();

  const payload: any = {
    source: state.source,
    mediaType: state.mediaType,
    lang: state.lang,

    // 优先使用选中条目
    id: state.selected?.id || (state.idInput || "").trim() || null,

    // TMDB episode group
    episodeGroupId: state.episodeGroupId || null,

    useAI: state.useAI,

    manual: {
      title: state.manual.title,
      originalTitle: state.manual.originalTitle,
      year: state.manual.year,
      plot: state.manual.plot,
      premiered: state.manual.premiered,
      rating: state.manual.rating,
      genres: state.manual.genres,
      studios: state.manual.studios,
      actors: state.manual.actors
    },

    manualStructure: {
      seasons: Number(state.manualStructure.seasons || 1),
      episodesPerSeason: Number(state.manualStructure.episodesPerSeason || 1),
      seasonEpisodeMap: parseSeasonMap(state.manualStructure.seasonEpisodeMapText || ""),
      episodeTitleTemplate: state.manualStructure.episodeTitleTemplate || "Episode {{ episode }}",
      seasonPlots: parseSeasonPlotMap(state.manualStructure.seasonPlotsText || ""),
      episodePlots: parseEpisodePlotMap(state.manualStructure.episodePlotsText || "")
    },

    manualEpisode: manualEp,

    rename: {
      tvFormat: state.rename.tvFormat,
      movieFormat: state.rename.movieFormat,
      customization: state.rename.customization,
      originals: getOriginalsList(),
      nfoNameMode: state.rename.nfoNameMode
    }
  };

  // manual source 时允许 id 为空
  if (payload.source === "manual") payload.id = null;

  return payload;
}

async function startGenerateAndDownload() {
  const payload = buildGeneratePayload();

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `generate failed: ${res.status}`);
  }

  // SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const setProgressText = (msg: string) => {
    state.status = msg;
    renderStatus();
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE event blocks separated by \n\n
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx < 0) break;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = block.split("\n");
      let ev = "message";
      let dataLine = "";

      for (const line of lines) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }

      const data = dataLine ? JSON.parse(dataLine) : {};

      if (ev === "progress") {
        const msg = data?.message
          ? `${data.step || "处理中"}：${data.message}`
          : `${data.step || "处理中"}…`;
        setProgressText(msg);
      } else if (ev === "done") {
        const url = data?.downloadUrl;
        if (url) {
          log("生成完成，开始下载 ZIP…");
          window.location.href = url;
          setProgressText("完成 ✅（已触发下载）");
        } else {
          setProgressText("完成 ✅");
        }
      } else if (ev === "error") {
        throw new Error(data?.message || "生成失败");
      }
    }
  }
}

/** ---------------------------
 * Render
 * --------------------------*/

function cardResult(item: SearchItem) {
  const y = item.year ? ` (${item.year})` : "";
  const t = escapeHtml(item.title + y);
  const o = item.originalTitle ? `<div class="muted">${escapeHtml(item.originalTitle)}</div>` : "";
  return `
    <div class="result-item" data-id="${escapeHtml(item.id)}">
      <div style="font-weight:700">${t}</div>
      ${o}
      <div class="muted">ID: ${escapeHtml(item.id)}</div>
    </div>
  `;
}

function renderSelected() {
  const el = $("selected");
  if (!state.selected) {
    el.innerHTML = `<div class="muted">未选择</div>`;
    return;
  }
  el.innerHTML = `
    <div style="font-weight:800">${escapeHtml(state.selected.title)}${state.selected.year ? ` (${escapeHtml(state.selected.year)})` : ""}</div>
    ${state.selected.originalTitle ? `<div class="muted">${escapeHtml(state.selected.originalTitle)}</div>` : ""}
    <div class="muted">ID: ${escapeHtml(state.selected.id)}</div>
  `;
}

function renderEpisodeGroups() {
  const el = $("episodeGroups");
  if (!state.episodeGroups.length) {
    el.innerHTML = `<div class="muted">暂无剧集组（仅 TMDB TV 可用，点击“查剧集组”加载）</div>`;
    return;
  }

  const items = state.episodeGroups
    .map((g) => {
      const active = g.id === state.episodeGroupId ? "active" : "";
      return `
      <div class="result-item ${active}" data-groupid="${escapeHtml(g.id)}">
        <div style="font-weight:700">${escapeHtml(g.name)}</div>
        ${g.description ? `<div class="muted">${escapeHtml(g.description)}</div>` : ""}
        <div class="muted">ID: ${escapeHtml(g.id)}</div>
      </div>
    `;
    })
    .join("");

  el.innerHTML = items;

  // click bind
  el.querySelectorAll("[data-groupid]").forEach((node) => {
    node.addEventListener("click", () => {
      state.episodeGroupId = (node as HTMLElement).dataset.groupid || "";
      log(`已选择剧集组：${state.episodeGroupId}`);
      renderEpisodeGroups();
    });
  });
}

function renderPreview(rows: any[]) {
  const el = $("previewResults");
  if (!rows?.length) {
    el.innerHTML = `<div class="muted">暂无预览</div>`;
    return;
  }
  el.innerHTML = rows
    .map((r) => {
      const parsed =
        r.parsed?.season && r.parsed?.episode
          ? `S${String(r.parsed.season).padStart(2, "0")}E${String(r.parsed.episode).padStart(2, "0")}`
          : "未解析";
      return `
      <div class="result-item">
        <div style="font-weight:700">${escapeHtml(r.original || "")}</div>
        <div class="muted">解析：${escapeHtml(parsed)}</div>
        ${r.mediaPath ? `<div class="muted">媒体路径：${escapeHtml(r.mediaPath)}</div>` : ""}
        ${Array.isArray(r.nfoPreview) ? `<div class="muted">NFO：${escapeHtml(r.nfoPreview.join(" , "))}</div>` : ""}
      </div>
    `;
    })
    .join("");
}

function render() {
  // 赋值表单
  ($("source") as HTMLSelectElement).value = state.source;
  ($("mediaType") as HTMLSelectElement).value = state.mediaType;
  ($("lang") as HTMLInputElement).value = state.lang;

  ($("query") as HTMLInputElement).value = state.query;
  ($("idInput") as HTMLInputElement).value = state.idInput;

  ($("useAI") as HTMLInputElement).checked = state.useAI;

  ($("m_title") as HTMLInputElement).value = state.manual.title;
  ($("m_originalTitle") as HTMLInputElement).value = state.manual.originalTitle;
  ($("m_year") as HTMLInputElement).value = state.manual.year;
  ($("m_plot") as HTMLTextAreaElement).value = state.manual.plot;
  ($("m_premiered") as HTMLInputElement).value = state.manual.premiered;
  ($("m_rating") as HTMLInputElement).value = state.manual.rating;
  ($("m_genres") as HTMLInputElement).value = state.manual.genres;
  ($("m_studios") as HTMLInputElement).value = state.manual.studios;
  ($("m_actors") as HTMLInputElement).value = state.manual.actors;

  ($("s_seasons") as HTMLInputElement).value = String(state.manualStructure.seasons);
  ($("s_epsPer") as HTMLInputElement).value = String(state.manualStructure.episodesPerSeason ?? "");
  ($("s_map") as HTMLInputElement).value = state.manualStructure.seasonEpisodeMapText ?? "";
  ($("s_epTitleTpl") as HTMLInputElement).value = state.manualStructure.episodeTitleTemplate ?? "";
  ($("s_seasonPlots") as HTMLTextAreaElement).value = state.manualStructure.seasonPlotsText ?? "";
  ($("s_episodePlots") as HTMLTextAreaElement).value = state.manualStructure.episodePlotsText ?? "";

  const meEnable = $("me_enable") as HTMLInputElement;
  meEnable.checked = state.manualEpisode.enabled;
  ($("me_season") as HTMLInputElement).value = String(state.manualEpisode.seasonNumber ?? "");
  ($("me_episode") as HTMLInputElement).value = String(state.manualEpisode.episodeNumber ?? "");
  ($("me_title") as HTMLInputElement).value = state.manualEpisode.title;
  ($("me_aired") as HTMLInputElement).value = state.manualEpisode.aired;
  ($("me_plot") as HTMLTextAreaElement).value = state.manualEpisode.plot;
  const manualEpDisabled = !state.manualEpisode.enabled;
  ["me_season", "me_episode", "me_title", "me_aired", "me_plot"].forEach((id) => {
    const node = $(id) as HTMLInputElement | HTMLTextAreaElement;
    node.disabled = manualEpDisabled;
  });

  ($("tvFormat") as HTMLTextAreaElement).value = state.rename.tvFormat;
  ($("movieFormat") as HTMLTextAreaElement).value = state.rename.movieFormat;
  ($("customization") as HTMLInputElement).value = state.rename.customization;
  ($("originals") as HTMLTextAreaElement).value = state.rename.originalsText;
  ($("nfoMode") as HTMLSelectElement).value = state.rename.nfoNameMode;

  renderSelected();
  renderEpisodeGroups();
  renderStatus();
  renderLogs();

  // 根据 source 显示/隐藏某些区域
  const manualBox = $("manualBox");
  manualBox.style.display = state.source === "manual" ? "block" : "none";

  const tmdbGroupBox = $("episodeGroupBox");
  tmdbGroupBox.style.display = state.source === "tmdb" && state.mediaType === "tv" ? "block" : "none";
}

/** ---------------------------
 * Bind events
 * --------------------------*/

function bind() {
  // 基本选择
  $("source").addEventListener("change", (e) => {
    state.source = (e.target as HTMLSelectElement).value as SourceType;
    state.selected = null;
    state.episodeGroups = [];
    state.episodeGroupId = "";
    render();
  });

  $("mediaType").addEventListener("change", (e) => {
    state.mediaType = (e.target as HTMLSelectElement).value as MediaType;
    state.selected = null;
    state.episodeGroups = [];
    state.episodeGroupId = "";
    render();
  });

  $("lang").addEventListener("change", (e) => {
    state.lang = (e.target as HTMLInputElement).value;
  });

  $("query").addEventListener("input", (e) => (state.query = (e.target as HTMLInputElement).value));
  $("idInput").addEventListener("input", (e) => (state.idInput = (e.target as HTMLInputElement).value));
  $("useAI").addEventListener("change", (e) => (state.useAI = (e.target as HTMLInputElement).checked));

  // manual
  $("m_title").addEventListener("input", (e) => (state.manual.title = (e.target as HTMLInputElement).value));
  $("m_originalTitle").addEventListener("input", (e) => (state.manual.originalTitle = (e.target as HTMLInputElement).value));
  $("m_year").addEventListener("input", (e) => (state.manual.year = (e.target as HTMLInputElement).value));
  $("m_plot").addEventListener("input", (e) => (state.manual.plot = (e.target as HTMLTextAreaElement).value));
  $("m_premiered").addEventListener("input", (e) => (state.manual.premiered = (e.target as HTMLInputElement).value));
  $("m_rating").addEventListener("input", (e) => (state.manual.rating = (e.target as HTMLInputElement).value));
  $("m_genres").addEventListener("input", (e) => (state.manual.genres = (e.target as HTMLInputElement).value));
  $("m_studios").addEventListener("input", (e) => (state.manual.studios = (e.target as HTMLInputElement).value));
  $("m_actors").addEventListener("input", (e) => (state.manual.actors = (e.target as HTMLInputElement).value));

  // structure
  $("s_seasons").addEventListener("input", (e) => (state.manualStructure.seasons = Number((e.target as HTMLInputElement).value || 1)));
  $("s_epsPer").addEventListener(
    "input",
    (e) => (state.manualStructure.episodesPerSeason = Number((e.target as HTMLInputElement).value || 1))
  );
  $("s_map").addEventListener("input", (e) => (state.manualStructure.seasonEpisodeMapText = (e.target as HTMLInputElement).value));
  $("s_epTitleTpl").addEventListener(
    "input",
    (e) => (state.manualStructure.episodeTitleTemplate = (e.target as HTMLInputElement).value)
  );
  $("s_seasonPlots").addEventListener(
    "input",
    (e) => (state.manualStructure.seasonPlotsText = (e.target as HTMLTextAreaElement).value)
  );
  $("s_episodePlots").addEventListener(
    "input",
    (e) => (state.manualStructure.episodePlotsText = (e.target as HTMLTextAreaElement).value)
  );

  // manual episode
  $("me_enable").addEventListener("change", (e) => {
    state.manualEpisode.enabled = (e.target as HTMLInputElement).checked;
    render();
  });
  $("me_season").addEventListener(
    "input",
    (e) => (state.manualEpisode.seasonNumber = Number((e.target as HTMLInputElement).value || 0))
  );
  $("me_episode").addEventListener(
    "input",
    (e) => (state.manualEpisode.episodeNumber = Number((e.target as HTMLInputElement).value || 0))
  );
  $("me_title").addEventListener("input", (e) => (state.manualEpisode.title = (e.target as HTMLInputElement).value));
  $("me_aired").addEventListener("input", (e) => (state.manualEpisode.aired = (e.target as HTMLInputElement).value));
  $("me_plot").addEventListener("input", (e) => (state.manualEpisode.plot = (e.target as HTMLTextAreaElement).value));

  // rename
  $("tvFormat").addEventListener("input", (e) => (state.rename.tvFormat = (e.target as HTMLTextAreaElement).value));
  $("movieFormat").addEventListener("input", (e) => (state.rename.movieFormat = (e.target as HTMLTextAreaElement).value));
  $("customization").addEventListener("input", (e) => (state.rename.customization = (e.target as HTMLInputElement).value));
  $("originals").addEventListener("input", (e) => (state.rename.originalsText = (e.target as HTMLTextAreaElement).value));
  $("nfoMode").addEventListener("change", (e) => (state.rename.nfoNameMode = (e.target as HTMLSelectElement).value as NfoNameMode));

  // 搜索
  $("btnSearch").addEventListener("click", async () => {
    try {
      setBusy(true, "搜索中…");
      log("开始搜索…");

      const items = await apiSearch();
      const box = $("results");
      if (!items.length) {
        box.innerHTML = `<div class="muted">没有搜索结果</div>`;
        state.selected = null;
        renderSelected();
        setBusy(false, "搜索完成（无结果）");
        return;
      }

      box.innerHTML = items.map(cardResult).join("");
      box.querySelectorAll("[data-id]").forEach((node) => {
        node.addEventListener("click", () => {
          const id = (node as HTMLElement).dataset.id || "";
          const hit = items.find((x) => x.id === id) || null;
          state.selected = hit;
          state.episodeGroups = [];
          state.episodeGroupId = "";
          log(`已选择：${hit?.title || id}`);
          renderSelected();
          renderEpisodeGroups();
        });
      });

      setBusy(false, `搜索完成：${items.length} 条`);
      log(`搜索完成：${items.length} 条`);
    } catch (e: any) {
      setBusy(false, "搜索失败");
      log(`搜索失败：${e?.message || String(e)}`);
    }
  });

  // 查剧集组
  $("btnEpisodeGroups").addEventListener("click", async () => {
    try {
      setBusy(true, "加载剧集组…");
      const groups = await apiEpisodeGroups();
      state.episodeGroups = groups;
      state.episodeGroupId = groups[0]?.id || "";
      renderEpisodeGroups();
      setBusy(false, `剧集组：${groups.length} 个`);
      log(`加载剧集组完成：${groups.length} 个`);
    } catch (e: any) {
      setBusy(false, "加载剧集组失败");
      log(`加载剧集组失败：${e?.message || String(e)}`);
    }
  });

  // ✅ 自动补全 originals（按首行）
  $("btnAutoFillOriginals").addEventListener("click", async () => {
    try {
      // 先同步 textarea -> state（避免用户刚粘贴但 state 还没更新）
      state.rename.originalsText = ($("originals") as HTMLTextAreaElement).value;

      const filled = autoFillOriginalsFromFirstLine();
      state.rename.originalsText = filled;
      ($("originals") as HTMLTextAreaElement).value = filled;

      log("已根据首行样例自动补全 originals 列表。");

      // 自动预览（更丝滑）
      setBusy(true, "生成预览…");
      log("开始生成预览（前50行）…");
      const data = await apiPreview();
      renderPreview(data.rows || []);
      setBusy(false, "预览完成 ✅");
      log("预览完成 ✅");
    } catch (e: any) {
      setBusy(false, "自动补全失败");
      log(`自动补全失败：${e?.message || String(e)}`);
    }
  });

  // 预览
  $("btnPreview").addEventListener("click", async () => {
    try {
      setBusy(true, "生成预览…");
      log("开始生成预览（前50行）…");
      const data = await apiPreview();
      renderPreview(data.rows || []);
      setBusy(false, "预览完成 ✅");
      log("预览完成 ✅");
    } catch (e: any) {
      setBusy(false, "预览失败");
      log(`预览失败：${e?.message || String(e)}`);
    }
  });

  // 一键生成并下载
  $("btnGenerate").addEventListener("click", async () => {
    try {
      // 基本校验
      if (state.source !== "manual") {
        const id = state.selected?.id || (state.idInput || "").trim();
        if (!id) {
          log("请先搜索并选择一个条目，或直接输入 ID。");
          return;
        }
      }

      setBusy(true, "开始生成…");
      log("开始生成并打包…");

      await startGenerateAndDownload();

      setBusy(false, "完成 ✅");
    } catch (e: any) {
      setBusy(false, "生成失败");
      log(`生成失败：${e?.message || String(e)}`);
    }
  });
}

/** ---------------------------
 * Mount
 * --------------------------*/

function injectSkeleton() {
  // 这里生成基础 DOM（你若已有 index.html 模板，也可以只保留 render/bind）
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app");

  root.innerHTML = `
  <div class="page">
    <div class="header">
      <div class="title">🎬 Emby Meta Tool</div>
      <div class="sub">元数据生成 / 重命名预览 / 同名 NFO（支持）</div>
      <div id="status" class="status"></div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">1) 数据源与搜索</div>

        <div class="row">
          <label class="label">数据源</label>
          <select id="source" class="input">
            <option value="tmdb">TMDB</option>
            <option value="bangumi">Bangumi</option>
            <option value="anidb">AniDB</option>
            <option value="manual">手动</option>
          </select>

          <label class="label">类型</label>
          <select id="mediaType" class="input">
            <option value="tv">剧集</option>
            <option value="movie">电影</option>
            <option value="anime">动漫</option>
          </select>

          <label class="label">语言</label>
          <input id="lang" class="input" value="zh-CN" />
        </div>

        <div class="row">
          <input id="query" class="input flex" placeholder="标题关键词（可空）" />
          <input id="idInput" class="input" style="width:220px" placeholder="或直接输入 ID" />
          <button id="btnSearch" class="btn">搜索</button>
        </div>

        <div class="split">
          <div>
            <div class="muted">搜索结果</div>
            <div id="results" class="results"><div class="muted">（搜索后显示）</div></div>
          </div>
          <div>
            <div class="muted">已选择</div>
            <div id="selected" class="results"><div class="muted">未选择</div></div>
          </div>
        </div>

        <div id="episodeGroupBox" style="margin-top:12px;">
          <div class="card-title">2) TMDB 剧集组（可选）</div>
          <div class="row">
            <button id="btnEpisodeGroups" class="btn">查剧集组</button>
            <div class="muted">选择一个剧集组后生成会以该顺序/结构输出</div>
          </div>
          <div id="episodeGroups" class="results"><div class="muted">暂无剧集组</div></div>
        </div>

        <div class="row" style="margin-top:12px;">
          <label class="checkbox">
            <input id="useAI" type="checkbox" />
            <span>AI 自动补全缺失字段（可选）</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-title">3) 手动元数据（manual 模式）</div>
        <div id="manualBox">
          <div class="row">
            <input id="m_title" class="input flex" placeholder="标题（必填）" />
            <input id="m_originalTitle" class="input flex" placeholder="原名（可选）" />
            <input id="m_year" class="input" style="width:120px" placeholder="年份" />
          </div>

          <div class="row">
            <input id="m_premiered" class="input" style="width:220px" placeholder="首播日期 YYYY-MM-DD" />
            <input id="m_rating" class="input" style="width:120px" placeholder="评分" />
            <input id="m_genres" class="input flex" placeholder="类型（逗号分隔）" />
          </div>

          <div class="row">
            <input id="m_studios" class="input flex" placeholder="制片公司（逗号分隔）" />
            <input id="m_actors" class="input flex" placeholder="演员（逗号分隔）" />
          </div>

          <textarea id="m_plot" class="textarea" rows="4" placeholder="简介（可选）"></textarea>

          <div class="card-title" style="margin-top:12px;">季 / 集结构</div>
          <div class="row">
            <input id="s_seasons" class="input" style="width:120px" placeholder="总季数" />
            <input id="s_epsPer" class="input" style="width:140px" placeholder="每季集数" />
            <input id="s_map" class="input flex" placeholder="每季集数映射：1:12,2:10（可选）" />
          </div>
          <div class="row">
            <input id="s_epTitleTpl" class="input flex" placeholder="集标题模板（可选）如 Episode {{ episode }}" />
          </div>

          <div class="card-title" style="margin-top:12px;">季 / 集简介（可选）</div>
          <div class="row">
            <textarea
              id="s_seasonPlots"
              class="textarea"
              rows="2"
              placeholder="每行一个季简介：1: 这一季的简介"
            ></textarea>
          </div>
          <div class="row">
            <textarea
              id="s_episodePlots"
              class="textarea"
              rows="3"
              placeholder="每行一个集简介：S01E02: 本集简介 或 1-2: 本集简介"
            ></textarea>
          </div>

          <div class="card-title" style="margin-top:12px;">单集元数据（可选）</div>
          <div class="row">
            <label class="checkbox">
              <input id="me_enable" type="checkbox" />
              <span>启用单集自定义（仅生成此集）</span>
            </label>
          </div>
          <div class="row">
            <input id="me_season" class="input" style="width:120px" placeholder="季号" />
            <input id="me_episode" class="input" style="width:120px" placeholder="集号" />
            <input id="me_title" class="input flex" placeholder="集标题" />
          </div>
          <div class="row">
            <input id="me_aired" class="input" style="width:220px" placeholder="首播日期 YYYY-MM-DD（可选）" />
          </div>
          <textarea id="me_plot" class="textarea" rows="3" placeholder="集简介（可选）"></textarea>
          <div class="muted">启用单集自定义后，系列/季信息以上方手动信息为准，集信息以此处填写为主。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">4) 重命名 & 同名 NFO</div>

        <div class="row">
          <label class="label" style="min-width:120px;">NFO 命名模式</label>
          <select id="nfoMode" class="input" style="width:260px;">
            <option value="both" selected>both（标准+同名，推荐）</option>
            <option value="standard">standard（仅 SxxEyy.nfo）</option>
            <option value="same_as_media">same_as_media（仅 同名.nfo）</option>
          </select>

          <button id="btnPreview" class="btn">预览命名</button>
          <button id="btnAutoFillOriginals" class="btn">🪄 自动补全（按首行）</button>
        </div>

        <div class="muted" style="margin:8px 0 6px;">
          原始文件名列表（每行一个）。用于：重命名映射 + 同名 NFO 生成 + 预览。
        </div>
        <textarea id="originals" class="textarea" rows="6" placeholder="lolihouse 2.5次元的诱惑 - S01E01 - 第 1 集 - 1080p.mkv"></textarea>

        <div class="row">
          <input id="customization" class="input flex" placeholder="customization（可选，模板可用 {{ customization }}）" />
        </div>

        <div class="muted" style="margin:10px 0 6px;">TV 模板</div>
        <textarea id="tvFormat" class="textarea" rows="3"></textarea>

        <div class="muted" style="margin:10px 0 6px;">Movie 模板</div>
        <textarea id="movieFormat" class="textarea" rows="3"></textarea>

        <div class="muted" style="margin:10px 0 6px;">预览结果（前 50 行）</div>
        <div id="previewResults" class="results"><div class="muted">暂无预览</div></div>
      </div>

      <div class="card">
        <div class="card-title">5) 一键生成并下载</div>
        <div class="row">
          <button id="btnGenerate" class="btn primary">生成并打包下载</button>
          <div class="muted">点一次即可（会显示进度并自动触发 ZIP 下载）</div>
        </div>
        <div class="muted" style="margin:10px 0 6px;">日志</div>
        <pre id="logs" class="logs"></pre>
      </div>
    </div>
  </div>
  `;

  // 注入一套轻量 CSS（Material v3 风格接近）
  const style = document.createElement("style");
  style.textContent = `
  .page{max-width:1100px;margin:18px auto;padding:0 14px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}
  .header{margin-bottom:14px;}
  .title{font-size:22px;font-weight:900;}
  .sub{color:#666;margin-top:4px;}
  .status{margin-top:10px;color:#444;font-weight:700;}
  .grid{display:grid;grid-template-columns:1fr;gap:12px;}
  @media(min-width:980px){.grid{grid-template-columns:1fr 1fr;}}
  .card{border:1px solid rgba(0,0,0,.12);border-radius:16px;padding:14px;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,.04);}
  .card-title{font-weight:900;margin-bottom:10px;}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0;}
  .split{display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px;}
  @media(min-width:700px){.split{grid-template-columns:1fr 1fr;}}
  .label{color:#666;font-size:12px;}
  .muted{color:#777;font-size:12px;}
  .input{border:1px solid rgba(0,0,0,.18);border-radius:12px;padding:10px 12px;font-size:14px;background:#fff;outline:none;}
  .input:focus{border-color:rgba(0,0,0,.35);}
  .textarea{width:100%;border:1px solid rgba(0,0,0,.18);border-radius:12px;padding:10px 12px;font-size:14px;outline:none;resize:vertical;}
  .textarea:focus{border-color:rgba(0,0,0,.35);}
  .btn{border:1px solid rgba(0,0,0,.18);border-radius:999px;padding:10px 14px;background:#fff;font-weight:800;cursor:pointer;}
  .btn:hover{background:rgba(0,0,0,.03);}
  .btn.primary{background:#1f6feb;color:#fff;border-color:#1f6feb;}
  .btn.primary:hover{filter:brightness(.95);}
  .flex{flex:1;min-width:220px;}
  .results{border:1px dashed rgba(0,0,0,.18);border-radius:14px;padding:10px;min-height:70px;background:rgba(0,0,0,.015);}
  .result-item{border:1px solid rgba(0,0,0,.10);border-radius:12px;padding:10px;margin:8px 0;background:#fff;cursor:pointer;}
  .result-item.active{border-color:#1f6feb;background:rgba(31,111,235,.06);}
  .logs{white-space:pre-wrap;word-break:break-word;border:1px solid rgba(0,0,0,.18);border-radius:12px;padding:10px;background:rgba(0,0,0,.03);min-height:120px;max-height:360px;overflow:auto;}
  .checkbox{display:flex;gap:10px;align-items:center;cursor:pointer;}
  `;
  document.head.appendChild(style);
}

export function mountUI() {
  injectSkeleton();
  bind();
  render();
  log("UI 已加载。");
}

/**
 * 兼容一些入口文件可能 import { renderApp } from "./ui"
 * 你项目里如果用 mountUI 也没问题。
 */
export function renderApp(root?: HTMLElement) {
  // 如果外部传入 root，尽量使用它作为 #app
  if (root && root.id !== "app") root.id = "app";
  mountUI();
}
