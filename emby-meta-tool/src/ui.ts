import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/textfield/filled-text-field.js";
import "@material/web/select/filled-select.js";
import "@material/web/select/select-option.js";
import "@material/web/progress/linear-progress.js";
import "@material/web/chips/filter-chip.js";
import { postSSE } from "./sse";

type Source = "tmdb" | "bangumi" | "anidb" | "manual";
type MediaType = "tv" | "movie" | "anime";

type SearchItem = {
  source: Source;
  id: string;
  title: string;
  year?: string;
  subtitle?: string;
  poster?: string;
  raw?: any;
};

type EpisodeGroupItem = {
  id: string;
  name: string;
  description?: string;
};

const el = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export function renderApp(root: HTMLElement) {
  const state = {
    source: "tmdb" as Source,
    mediaType: "tv" as MediaType,
    query: "",
    id: "",
    lang: "zh-CN",
    tmdbEpisodeGroupId: "",
    selected: null as SearchItem | null,
    groups: [] as EpisodeGroupItem[],

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

    // ✅ 手动季集结构
    manualStructure: {
      seasons: "1",
      episodesPerSeason: "12",
      seasonEpisodeMap: "", // e.g. 1:12,2:10
      episodeTitleTemplate: "Episode {{ episode }}"
    },

    // ✅ 重命名
    rename: {
      tvFormat: `{{ title }}{% if year %} ({{ year }}){% endif %}/Season {{ season }}/{{ title }} - {{ season_episode }}{% if episode_title %} - {{ episode_title }}{% endif %}{{ fileExt }}`,
      movieFormat: `{{ title }}{% if year %} ({{ year }}){% endif %}/{{ title }}{% if year %} ({{ year }}){% endif %}{{ fileExt }}`,
      customization: "",
      originals: ""
    },

    useAI: false,
    logs: [] as string[],
    running: false,
    progress: { step: "", current: 0, total: 0 }
  };

  const app = el(`
    <div class="container">
      <div class="header">
        <div style="font-size:20px;font-weight:700;">Emby 元数据生成 / 打包下载</div>
        <div class="muted">支持 TMDB/Bangumi/AniDB/纯手动；支持 TMDB 剧集组；支持 MoviePilot 风格重命名映射</div>
      </div>

      <div class="card grid">
        <div class="grid2">
          <div class="grid">
            <md-filled-select id="source" label="数据源">
              <md-select-option value="tmdb" selected><div slot="headline">TMDB</div></md-select-option>
              <md-select-option value="bangumi"><div slot="headline">Bangumi</div></md-select-option>
              <md-select-option value="anidb"><div slot="headline">AniDB（标题索引走R2）</div></md-select-option>
              <md-select-option value="manual"><div slot="headline">纯手动（不抓取）</div></md-select-option>
            </md-filled-select>

            <md-filled-select id="mediaType" label="内容类型">
              <md-select-option value="tv" selected><div slot="headline">电视剧 / 番剧（TV）</div></md-select-option>
              <md-select-option value="movie"><div slot="headline">电影（Movie）</div></md-select-option>
              <md-select-option value="anime"><div slot="headline">动漫（Anime，仍按 TV 结构输出）</div></md-select-option>
            </md-filled-select>

            <md-filled-text-field id="query" label="标题检索（可空；一键生成时可自动检索）"></md-filled-text-field>
            <md-filled-text-field id="id" label="直接输入ID（可空，优先于标题；manual模式可空）"></md-filled-text-field>

            <div class="row">
              <md-filled-text-field id="lang" label="语言（TMDB/Bangumi）" value="zh-CN" style="min-width:180px;"></md-filled-text-field>
              <md-outlined-button id="btnSearch">检索</md-outlined-button>
            </div>

            <div class="row">
              <md-filled-text-field id="episodeGroup" label="TMDB 剧集组ID（可选，仅 TV）" style="flex:1;"></md-filled-text-field>
              <md-outlined-button id="btnGroups">查剧集组</md-outlined-button>
            </div>

            <div>
              <div class="muted" style="margin:6px 0 8px 2px;">剧集组列表（点击“使用这个剧集组”自动填入 groupId）</div>
              <div class="results" id="groupResults"></div>
            </div>

            <div class="row">
              <md-filter-chip id="chipAI" label="AI 自动补全缺失字段"></md-filter-chip>
            </div>

            <div class="row">
              <md-filled-button id="btnGenerate">一键生成并打包下载</md-filled-button>
              <span class="muted">不需要先点“选择”：如果没选中会自动检索并取最匹配</span>
            </div>
          </div>

          <div class="grid">
            <div style="font-weight:700;">手动填写（可选，用于覆盖/补全）</div>
            <div class="grid2">
              <md-filled-text-field id="mTitle" label="标题"></md-filled-text-field>
              <md-filled-text-field id="mOriginal" label="原名"></md-filled-text-field>
            </div>
            <div class="grid2">
              <md-filled-text-field id="mYear" label="年份"></md-filled-text-field>
              <md-filled-text-field id="mPremiered" label="首播/上映日期（YYYY-MM-DD）"></md-filled-text-field>
            </div>
            <md-filled-text-field id="mPlot" label="简介/剧情" type="textarea"></md-filled-text-field>
            <div class="grid2">
              <md-filled-text-field id="mRating" label="评分（0-10）"></md-filled-text-field>
              <md-filled-text-field id="mGenres" label="类型（逗号分隔）"></md-filled-text-field>
            </div>
            <div class="grid2">
              <md-filled-text-field id="mStudios" label="制作公司/工作室（逗号）"></md-filled-text-field>
              <md-filled-text-field id="mActors" label="演员（逗号）"></md-filled-text-field>
            </div>

            <div style="margin-top:6px;font-weight:700;">手动季/集结构（manual 模式或想补齐时）</div>
            <div class="grid2">
              <md-filled-text-field id="msSeasons" label="总季数" value="1"></md-filled-text-field>
              <md-filled-text-field id="msEpsPer" label="每季集数（统一）" value="12"></md-filled-text-field>
            </div>
            <md-filled-text-field id="msMap" label="每季集数映射（可选：1:12,2:10,3:8）"></md-filled-text-field>
            <md-filled-text-field id="msEpTpl" label="集标题模板（可选）" value="Episode {{ episode }}"></md-filled-text-field>

            <div style="margin-top:6px;font-weight:700;">重命名（生成媒体文件重命名映射，打包进 zip/rename）</div>
            <md-filled-text-field id="rTvFmt" label="TV_RENAME_FORMAT（简化jinja2）" type="textarea"></md-filled-text-field>
            <md-filled-text-field id="rMovieFmt" label="MOVIE_RENAME_FORMAT（简化jinja2）" type="textarea"></md-filled-text-field>
            <md-filled-text-field id="rCustom" label="customization（可选）"></md-filled-text-field>
            <md-filled-text-field id="rOriginals" label="原始文件名列表（一行一个；可包含扩展名）" type="textarea"></md-filled-text-field>
            <div class="muted">提示：会输出 rename/rename_map.csv（original,new）</div>
          </div>
        </div>

        <div>
          <md-linear-progress id="progressBar" value="0" max="1"></md-linear-progress>
          <div class="muted" id="progressText">未开始</div>
        </div>

        <div class="grid2">
          <div>
            <div style="font-weight:700;margin-bottom:8px;">检索结果（点击选择可更精确）</div>
            <div class="results" id="results"></div>
          </div>
          <div>
            <div style="font-weight:700;margin-bottom:8px;">任务日志</div>
            <div class="progress-log" id="logs"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  root.appendChild(app);
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>("#" + id)!;

  // 初始化默认模板
  ($("rTvFmt") as any).value = state.rename.tvFormat;
  ($("rMovieFmt") as any).value = state.rename.movieFormat;

  const log = (s: string) => {
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${s}`);
    if (state.logs.length > 300) state.logs.pop();
    $("logs").textContent = state.logs.join("\n");
  };

  const setProgress = (step: string, current = 0, total = 0) => {
    state.progress = { step, current, total };
    const ratio = total > 0 ? Math.min(1, current / total) : (state.running ? 0.2 : 0);
    const bar = $("progressBar") as any;
    bar.value = ratio;
    bar.max = 1;
    $("progressText").textContent = total > 0 ? `${step}（${current}/${total}）` : step;
  };

  const clearGroupResults = (msg?: string) => {
    const box = $("groupResults");
    box.innerHTML = "";
    if (msg) box.appendChild(el(`<div class="muted">${escapeHtml(msg)}</div>`));
  };

  const renderGroups = (groups: EpisodeGroupItem[]) => {
    const box = $("groupResults");
    box.innerHTML = "";
    if (!groups?.length) {
      box.appendChild(el(`<div class="muted">该剧没有可用剧集组</div>`));
      return;
    }
    for (const g of groups) {
      const node = el(`
        <div class="result-item">
          <div class="row" style="justify-content:space-between;">
            <div style="font-weight:700;">${escapeHtml(g.name)}</div>
            <div class="muted">groupId=${escapeHtml(g.id)}</div>
          </div>
          ${g.description ? `<div class="muted">${escapeHtml(g.description)}</div>` : ""}
          <div class="row">
            <md-outlined-button>使用这个剧集组</md-outlined-button>
          </div>
        </div>
      `);
      node.querySelector("md-outlined-button")!.addEventListener("click", () => {
        ($("episodeGroup") as any).value = g.id;
        state.tmdbEpisodeGroupId = g.id;
        log(`已选定剧集组：${g.name}（${g.id}）`);
      });
      box.appendChild(node);
    }
  };

  const renderResults = (items: SearchItem[]) => {
    const box = $("results");
    box.innerHTML = "";
    if (!items.length) {
      box.appendChild(el(`<div class="muted">无结果</div>`));
      return;
    }
    for (const it of items) {
      const node = el(`
        <div class="result-item">
          <div class="row" style="justify-content:space-between;">
            <div style="font-weight:700;">${escapeHtml(it.title)}</div>
            <div class="muted">${it.source.toUpperCase()} #${escapeHtml(it.id)} ${it.year ? `(${escapeHtml(it.year)})` : ""}</div>
          </div>
          ${it.subtitle ? `<div class="muted">${escapeHtml(it.subtitle)}</div>` : ""}
          <div class="row">
            <md-outlined-button>选择</md-outlined-button>
            ${it.poster ? `<img src="${it.poster}" style="height:64px;border-radius:10px;object-fit:cover;" />` : ""}
          </div>
        </div>
      `);

      node.querySelector("md-outlined-button")!.addEventListener("click", () => {
        state.selected = it;
        log(`已选择：${it.title}（${it.source} #${it.id}）`);
        clearGroupResults("已选择新条目，可点击“查剧集组”获取该剧的剧集组。");
        if (!state.manual.title) ($("mTitle") as any).value = it.title;
      });

      box.appendChild(node);
    }
  };

  const parseSeasonMap = (s: string): Record<string, number> => {
    const out: Record<string, number> = {};
    const txt = (s || "").trim();
    if (!txt) return out;
    const parts = txt.split(/[,，]/g).map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
      const [k, v] = p.split(":").map((x) => x.trim());
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  };

  const getInputs = () => {
    state.source = (($("source") as any).value || "tmdb") as Source;
    state.mediaType = (($("mediaType") as any).value || "tv") as MediaType;
    state.query = ($("query") as any).value || "";
    state.id = ($("id") as any).value || "";
    state.lang = ($("lang") as any).value || "zh-CN";
    state.tmdbEpisodeGroupId = ($("episodeGroup") as any).value || "";

    state.manual.title = ($("mTitle") as any).value || "";
    state.manual.originalTitle = ($("mOriginal") as any).value || "";
    state.manual.year = ($("mYear") as any).value || "";
    state.manual.premiered = ($("mPremiered") as any).value || "";
    state.manual.plot = ($("mPlot") as any).value || "";
    state.manual.rating = ($("mRating") as any).value || "";
    state.manual.genres = ($("mGenres") as any).value || "";
    state.manual.studios = ($("mStudios") as any).value || "";
    state.manual.actors = ($("mActors") as any).value || "";

    state.manualStructure.seasons = ($("msSeasons") as any).value || "1";
    state.manualStructure.episodesPerSeason = ($("msEpsPer") as any).value || "12";
    state.manualStructure.seasonEpisodeMap = ($("msMap") as any).value || "";
    state.manualStructure.episodeTitleTemplate = ($("msEpTpl") as any).value || "Episode {{ episode }}";

    state.rename.tvFormat = ($("rTvFmt") as any).value || "";
    state.rename.movieFormat = ($("rMovieFmt") as any).value || "";
    state.rename.customization = ($("rCustom") as any).value || "";
    state.rename.originals = ($("rOriginals") as any).value || "";
  };

  $("chipAI").addEventListener("click", () => {
    state.useAI = !state.useAI;
    const chip = $("chipAI") as any;
    chip.selected = state.useAI;
    log(state.useAI ? "已开启：AI 自动补全" : "已关闭：AI 自动补全");
  });

  $("btnSearch").addEventListener("click", async () => {
    getInputs();
    state.running = true;
    setProgress("检索中…");
    log(`开始检索：source=${state.source}, query=${state.query || "-"}, id=${state.id || "-"}`);

    state.selected = null;
    clearGroupResults("请先从检索结果中选择一个 TMDB TV 条目，然后再查剧集组。");

    try {
      const items = await doSearch(state.source, state.mediaType, state.lang, state.id, state.query);
      renderResults(items);
      log(`检索完成：${items.length} 条`);
      setProgress("检索完成");
    } catch (e: any) {
      log(`检索失败：${e?.message || e}`);
      setProgress("检索失败");
    } finally {
      state.running = false;
    }
  });

  $("btnGroups").addEventListener("click", async () => {
    getInputs();

    if (state.source !== "tmdb") {
      log("只有 TMDB 支持剧集组检索");
      return;
    }
    if (state.mediaType === "movie") {
      log("电影没有 TMDB Episode Groups（请切换为 TV）");
      return;
    }

    const tvId = state.selected?.id || state.id;
    if (!tvId) {
      log("请先检索并选择一个 TMDB TV 条目（或在“直接输入ID”里填 TV ID）");
      clearGroupResults("缺少 TMDB TV ID：请先选择一个 TV 条目。");
      return;
    }

    state.running = true;
    setProgress("获取剧集组…");
    clearGroupResults("获取中…");
    log(`获取剧集组：tvId=${tvId}`);

    try {
      const url = new URL("/api/tmdb-episode-groups", location.origin);
      url.searchParams.set("tvId", tvId);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "获取失败");

      const groups: EpisodeGroupItem[] = data.groups || [];
      state.groups = groups;

      if (!groups.length) {
        log("未找到剧集组（或该剧没有剧集组）");
        clearGroupResults("未找到剧集组（或该剧没有剧集组）");
      } else {
        log(`找到剧集组：${groups.length} 个（页面已展示，可一键使用）`);
        renderGroups(groups);
      }
      setProgress("剧集组获取完成");
    } catch (e: any) {
      log(`剧集组获取失败：${e?.message || e}`);
      setProgress("剧集组获取失败");
      clearGroupResults(`剧集组获取失败：${e?.message || e}`);
    } finally {
      state.running = false;
    }
  });

  // ✅ 一键生成：自动检索/自动选中/然后 SSE 生成
  $("btnGenerate").addEventListener("click", async () => {
    getInputs();

    // 一键逻辑：如果不是 manual 且没有 id/selected，但有 query => 自动 search 并自动选一个
    if (state.source !== "manual" && !state.id && !state.selected?.id && state.query.trim()) {
      log("未选择条目，开始自动检索并选择最匹配结果…");
      try {
        const items = await doSearch(state.source, state.mediaType, state.lang, "", state.query);
        renderResults(items);

        if (!items.length) {
          log("自动检索无结果：请检查标题或改用手动模式");
          return;
        }

        // 只有 1 条就直接用；多条取第一条并提醒
        state.selected = items[0];
        log(items.length === 1
          ? `自动选中：${items[0].title}（唯一匹配）`
          : `自动选中：${items[0].title}（共${items.length}条，建议先手动选择更精确的条目）`
        );
      } catch (e: any) {
        log(`自动检索失败：${e?.message || e}`);
        return;
      }
    }

    const base = state.selected?.id || state.id || null;

    // manual 模式允许 base 为 null，但 title 最好有
    if (state.source === "manual" && !state.manual.title) {
      log("纯手动模式：请至少填写“标题”");
      return;
    }

    if (state.source !== "manual" && !base && !state.manual.title) {
      log("请先选择条目 / 输入ID / 或至少手工填写标题");
      return;
    }

    state.logs = [];
    $("logs").textContent = "";
    state.running = true;
    setProgress("开始生成…");
    log("开始生成任务（SSE）…");

    const originals = state.rename.originals
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const payload = {
      source: state.source,
      mediaType: state.mediaType,
      lang: state.lang,
      id: base,
      episodeGroupId: state.tmdbEpisodeGroupId || null,
      useAI: state.useAI,
      manual: state.manual,

      manualStructure: {
        seasons: Number(state.manualStructure.seasons || "1"),
        episodesPerSeason: Number(state.manualStructure.episodesPerSeason || "1"),
        seasonEpisodeMap: parseSeasonMap(state.manualStructure.seasonEpisodeMap),
        episodeTitleTemplate: state.manualStructure.episodeTitleTemplate || "Episode {{ episode }}"
      },

      rename: {
        tvFormat: state.rename.tvFormat,
        movieFormat: state.rename.movieFormat,
        customization: state.rename.customization,
        originals
      }
    };

    try {
      await postSSE("/api/generate", payload, (msg) => {
        if (msg.event === "progress") {
          const { step, current, total, message } = msg.data || {};
          if (message) log(message);
          setProgress(step || "处理中…", current || 0, total || 0);
        }
        if (msg.event === "error") {
          log(`错误：${msg.data?.message || "未知错误"}`);
          setProgress("失败");
        }
        if (msg.event === "done") {
          const { downloadUrl } = msg.data || {};
          log("生成完成 ✅");
          setProgress("生成完成");
          if (downloadUrl) {
            log(`下载：${downloadUrl}`);
            window.open(downloadUrl, "_blank");
          }
        }
      });
    } catch (e: any) {
      log(`生成失败：${e?.message || e}`);
      setProgress("生成失败");
    } finally {
      state.running = false;
    }
  });

  clearGroupResults("提示：先用 TMDB 搜索并选择 TV 条目，再点击“查剧集组”；或直接点“一键生成”自动检索。");
}

async function doSearch(source: string, mediaType: string, lang: string, id: string, q: string): Promise<SearchItem[]> {
  const url = new URL("/api/search", location.origin);
  url.searchParams.set("source", source);
  url.searchParams.set("mediaType", mediaType);
  if (lang) url.searchParams.set("lang", lang);
  if (id) url.searchParams.set("id", id);
  if (q) url.searchParams.set("q", q);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "检索失败");
  return (data.items || []) as SearchItem[];
}

function escapeHtml(s: string) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
