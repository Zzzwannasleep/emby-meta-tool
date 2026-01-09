# 🎬 Emby Meta Tool

[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
![No CLI Required](https://img.shields.io/badge/No-CLI%20Required-success)
![Web App](https://img.shields.io/badge/Web-App-blue)
![Emby](https://img.shields.io/badge/Emby-Metadata%20Ready-52B54B)
![Jellyfin](https://img.shields.io/badge/Jellyfin-Compatible-00A4DC)
![License](https://img.shields.io/github/license/Zzzwannasleep/emby-meta-tool)

一款 **Cloudflare Pages + Workers + KV + R2** 的网页端 Emby/Jellyfin 元数据生成工具。  
支持 TMDB / Bangumi / AniDB / 纯手动模式，生成 Emby 可识别的 **NFO + 图片目录结构**，内置 MoviePilot 风格重命名映射。  
现在还支持 **直接上传到 OpenList / Rclone**，并提供 **2:3 TMDB 比例海报/季封面裁剪器**。

> ✅ 无需 wrangler / 无需本地 CLI  
> ✅ 所有操作都在网页完成  
> ✅ 适合 Emby / Jellyfin / NAS 用户

---

## ✅ 核心特性
- 纯网页端操作（Cloudflare Pages）
- TMDB / Bangumi / AniDB 抓取，支持剧集组 Episode Groups
- AI 自动补全缺失字段（可选）
- 手动模式：自定义季/集结构与元信息
- 生成标准 Emby 元数据目录结构
- MoviePilot 风格重命名映射（rename_map.csv）
- 自动解析原始文件名中的 SxxEyy / 1x02 / 第X集
- 标准 SxxEyy.nfo & 同名 NFO（双写可选）
- **一键上传元数据到 OpenList / Rclone 远端（无需再下 ZIP）**
- **内置 2:3 海报/季封面裁剪，裁好直接写入生成目录/上传**

---

## 📦 生成内容
```
Show Name (Year)/
├─ tvshow.nfo
├─ poster.jpg
├─ fanart.jpg
├─ Season 01/
│  ├─ season.nfo
│  ├─ S01E01.nfo
│  └─ ...
└─ rename/
   ├─ rename_map.csv
   └─ rename_preview.txt
```

> ⚠️ 注意  
> - 不会改动/重命名你的媒体文件；仅生成映射。  
> - 开启“上传”时，目录会直接推到远端；若要同时保留 ZIP，在请求体加 `zipAfterUpload=true`。

---

## ☁️ 直接上传到 OpenList / Rclone
1) 前端点击 “上传至 OpenList / Rclone”。  
2) 弹窗里浏览远端目录（调用 `/api/upload-list`），选择目标路径。  
3) 确认后生成并直接上传，SSE 显示进度；默认不打包 ZIP。

### 环境变量
**OpenList**
```
OPENLIST_ENABLED=1
OPENLIST_BASE=https://fox.oplist.org        # 你的基址
OPENLIST_TOKEN=...                          # 二选一：token
# 或
OPENLIST_USERNAME=...                       # 二选一：账号密码
OPENLIST_PASSWORD=...
```

**Rclone RC**
```
RCLONE_ENABLED=1
RCLONE_RC_URL=http://127.0.0.1:5572         # rclone rc --rc-addr
RCLONE_FS=remote:emby-meta                  # rclone 配置的 fs 名
RCLONE_BASE_DIR=/meta                       # 可选，远端基础目录
RCLONE_RC_USER=...                          # 若 rc 开 auth
RCLONE_RC_PASS=...
```
行为说明：`uploadTarget=openlist|rclone` 时直接上传；若想同时保存 ZIP，附带 `zipAfterUpload=true`。

---

## 🎨 海报 / 季封面裁剪
- 固定 2:3（TMDB 标准），支持主海报与季封面。
- 选择图片 → 调整缩放/水平/垂直滑块 → Canvas 实时预览。
- 导出 JPEG 写入目录：`poster.jpg`、`Season XX/poster.jpg`，并参与上传/打包。

---

## 🚀 在线部署（Cloudflare Pages）
> Cloudflare Pages 目前没有“Deploy with Workers”一键按钮，但按以下步骤 2~3 分钟即可完成。

### 前置
- GitHub 账号  
- Cloudflare 账号  
- Cloudflare R2 Bucket（存放生成的 ZIP）  
- Cloudflare KV Namespace（缓存/索引）

### 步骤
1. Fork 本仓库到你的 GitHub  
2. Cloudflare Dashboard → Pages → Create a project → 选择 Fork  
3. 构建参数  
   | 项 | 值 |
   |---|---|
   | Root directory | `emby-meta-tool` |
   | Build command | `npm run build` |
   | Output directory | `dist` |
4. 点击 Deploy

### 必选 Bindings（Pages → Settings → Bindings）
- R2 Bucket：`META_BUCKET`
- KV Namespace：`META_KV`
> 生产环境也要配置，否则生成会失败。

---

## 🧰 开发
```bash
pnpm install   # 或 npm install
npm run dev
npm run build
```

---

## 📜 License
MIT
