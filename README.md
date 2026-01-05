# 🎬 Emby Meta Tool

一款 **完全基于 Cloudflare Pages + Workers + KV + R2 的网页端 Emby 元数据生成工具**。  
支持 **TMDB / Bangumi / AniDB / 纯手动模式**，可生成 **Emby 可识别的 NFO + 图片结构**，并支持 **MoviePilot 风格的文件重命名映射**。

> ✨ 无需 wrangler / 无需本地 CLI  
> ✨ 所有操作均在网页端完成  
> ✨ 适合 Emby / Jellyfin / NAS 用户使用

---

## ✨ 核心特性

- ✅ 完全网页端操作（Cloudflare Pages）
- ✅ TMDB / Bangumi / AniDB 元数据抓取
- ✅ TMDB Episode Groups（剧集组）可视化选择
- ✅ 支持 AI 自动补全缺失字段（可选）
- ✅ 支持 **纯手动模式**（无任何外部 API）
- ✅ 支持 **手动定义季 / 集结构**
- ✅ 生成 **标准 Emby 元数据目录结构**
- ✅ MoviePilot 风格重命名（生成 rename 映射文件）
- ✅ 自动解析原始文件名中的 SxxEyy / 1x02 / 第X集

---

## 📦 生成内容说明

生成的 ZIP 文件包含：

```

Show Name (Year)/
├─ tvshow.nfo
├─ poster.jpg
├─ fanart.jpg
├─ Season 01/
│  ├─ season.nfo
│  ├─ S01E01.nfo
│  ├─ S01E02.nfo
│  └─ ...
└─ rename/
├─ rename_map.csv
└─ rename_preview.txt

```

> ⚠️ **注意**
>
> - Emby 对 NFO 文件名有严格要求  
> - 本工具 **不会直接重命名媒体文件**  
> - 而是生成 **重命名映射文件（rename_map.csv）**，用于 MoviePilot / 批量重命名工具

---

## 🚀 在线部署（Cloudflare Pages）

### 前置条件

- GitHub 账号
- Cloudflare 账号
- Cloudflare R2 Bucket
- Cloudflare KV Namespace

---

### 部署步骤（纯网页端）

1. Fork 或 Clone 本仓库
2. Cloudflare Dashboard → Pages → Create Project
3. 选择该 GitHub 仓库
4. 构建设置：
   - **Root directory**：`emby-meta-tool`
   - **Build command**：`npm run build`
   - **Output directory**：`dist`

---

### 必须的 Bindings（非常重要）

在 Pages → Settings → **Bindings** 中配置：

#### R2 Bucket
| 类型 | 名称 |
|----|----|
| Variable name | `META_BUCKET` |
| Bucket | 你创建的 R2 Bucket |

#### KV Namespace
| 类型 | 名称 |
|----|----|
| Variable name | `META_KV` |
| Namespace | 你创建的 KV |

> ⚠️ **请确保 Production 环境也配置了以上绑定**

---

## 🔑 API Key & 环境变量配置（非常重要）

本项目部分数据源需要 API Key 才能正常工作，请在 Cloudflare Pages 中正确配置。

### ✅ TMDB（必需）

本工具使用 **官方 TMDB API**，必须提供 API Key。

#### 获取方式

1. 注册 / 登录 https://www.themoviedb.org
2. 进入账号设置 → API
3. 创建 API Key（v4 Token 或 v3 Key 均可）

#### Cloudflare Pages 配置

在 **Pages → Settings → Environment Variables** 中添加：

| 名称 | 值 |
|----|----|
| `TMDB_API_KEY` | 你的 TMDB API Key |

> 建议添加到 **Production** 和 **Preview** 环境

#### 未配置会发生什么？

- TMDB 搜索失败
- 剧集组（Episode Groups）无法加载
- 图片下载失败
- 页面只会提示“检索失败”

### ℹ️ AniDB（当前版本不需要 Client ID）

> ⚠️ 重要说明

当前版本 **未直接使用官方 AniDB UDP API**，而是采用：
- 公共索引数据
- + 手动填写 / AI 补全兜底

因此：

- ❌ **不需要 AniDB clientId**
- ❌ 不需要 client name / version
- ✅ 可直接使用

> 后续如果改为 **官方 AniDB API 模式**，才会引入 clientId / 限速 / 登录等配置。

### ℹ️ Bangumi

- 使用 Bangumi 公共 API
- 当前版本 **不强制要求 Access Token**
- 可能存在公共速率限制，但对一般使用足够

---

### 🤖 AI 自动补全（可选）

若启用 AI 自动补全功能，需要配置 AI 接口。

#### 示例（OpenAI / 兼容接口）

| 名称 | 说明 |
|----|----|
| `AI_API_KEY` | API Key |
| `AI_API_BASE` | API Base URL（可选） |
| `AI_MODEL` | 模型名（如 gpt-4o-mini） |

> 未配置 AI 不影响其他功能。

---

### 📦 Cloudflare Bindings（再次确认）

以下绑定 **必须存在**，否则生成阶段会失败：

#### R2 Bucket
| 变量名 | 说明 |
|----|----|
| `META_BUCKET` | 存放生成的 ZIP 文件 |

#### KV Namespace
| 变量名 | 说明 |
|----|----|
| `META_KV` | 缓存 / 索引数据 |

⚠️ **Production 环境也必须配置**

---


## 🧪 使用指南

### 1️⃣ 普通刮削（推荐）

1. 选择数据源（TMDB / Bangumi / AniDB）
2. 输入标题（或 ID）
3. **直接点击「一键生成并打包下载」**
4. 工具会：
   - 自动检索
   - 自动选择最匹配条目
   - 自动生成 ZIP

---

### 2️⃣ TMDB 剧集组（Episode Groups）

1. 数据源选择 TMDB
2. 搜索并选择 TV 条目
3. 点击「查剧集组」
4. 从列表中选择一个剧集组
5. 再点击「一键生成」

---

### 3️⃣ 纯手动模式（不依赖任何 API）

适合以下情况：

- 无码番 / 冷门资源
- 私人拍摄内容
- 无法被 TMDB / Bangumi 收录的作品

#### 使用方法

1. 数据源选择 **manual**
2. 手动填写：
   - 标题
   - 年份 / 简介（可选）
3. 填写季 / 集结构
4. 点击生成

---

## 🧩 手动季 / 集结构说明

支持两种方式：

### 统一每季集数
```

总季数：3
每季集数：12

```

### 指定每季集数映射
```

1:12,2:10,3:8

```

### 集标题模板（可选）
```

Episode {{ episode }}
{{ season_episode }}
第 {{ episode }} 集

```

---

## 🪄 重命名功能（MoviePilot 风格）

### 输入内容

在「原始文件名列表」中粘贴：

```

My.Show.S01E01.1080p.mkv
My.Show.1x02.WEB-DL.mp4
我的剧 第03集.mkv

```

---

### 输出文件

生成 ZIP 中会包含：

```

rename/rename_map.csv
rename/rename_preview.txt

````

### 示例 rename_map.csv

```csv
original,new
My.Show.S01E01.1080p.mkv,My Show/Season 01/My Show - S01E01.mkv
````

---

## 🔍 自动解析规则（已支持）

工具会自动从原始文件名中解析：

* `S01E02`
* `1x02`
* `第1季第2集`
* `第02集`
* `EP02 / E02`

若无法解析，将自动按顺序回退匹配，**保证不会生成失败**。

---

## 🧠 AI 自动补全（可选）

* 通过环境变量配置 AI（OpenAI / 兼容 API）
* 用于补全：

  * 简介
  * 原名
  * 类型
  * 演员等

> 若未配置 AI，不影响其他功能。

---

## 📁 项目结构说明

```
emby-meta-tool/
├─ src/                # 前端 UI（Material Design v3）
├─ functions/          # Cloudflare Pages Functions
│  └─ api/
│     ├─ generate.ts   # 核心生成逻辑
│     ├─ search.ts
│     └─ ...
├─ shared/
│  ├─ emby.ts          # Emby NFO 生成
│  ├─ rename.ts        # 重命名解析 & 模板
│  ├─ tmdb.ts
│  └─ bangumi.ts
└─ README / docs
```

---

## ❓ 常见问题（FAQ）

### Q：为什么不直接重命名媒体文件？

A：浏览器无法安全访问本地媒体文件，本工具生成 **映射表**，由 MoviePilot / 批量重命名工具执行。

### Q：为什么 NFO 名称不能自定义？

A：Emby 对元数据文件名有严格规范，错误命名将无法识别。

### Q：可以支持 Jellyfin 吗？

A：目录结构与 Jellyfin 高度兼容，理论可用。

---

## 🤝 贡献指南

欢迎 PR / Issue！

建议方向：

* 新数据源支持
* 重命名模板增强
* UI / UX 优化
* 文档补充

## 📄 License

MIT License

