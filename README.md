# Russian Block

一个面向 Windows 浏览器和 Android 浏览器的单人俄罗斯方块 Web/PWA。安卓端以滑屏和轻触为主，仓库内置 GitHub Pages 静态发布工作流，并提供 6 套主题、4 个单机模式、本地战绩和本地回放。

## 本地运行

### 开发

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。

### 构建

```powershell
npm run build
```

构建结果会输出到 `dist/`。

### 预览构建产物

```powershell
npm run preview
```

打开 `http://127.0.0.1:4173`。

### 游戏回归检查

```powershell
npm run test:game
```

默认会执行引擎级烟雾测试、模式回归、桌面键盘回归、主题回归和安卓手势回归，并把截图与状态写到 `output/web-game/`。

## 操作说明

- 键盘：`A/D` 或左右键移动，`S` 或下方向键软降，`W` 或上方向键旋转，`Space` 硬降，`C` 暂存，`P` 暂停，`R` 重开，`F` 全屏。
- 触屏：左右滑移动，单击旋转，下拖并停留会软降，下甩会硬降，双击 Hold；顶部保留暂停和设置。
- 模式：支持 `Marathon`、`Sprint 40L`、`Ultra 120s`、`Challenge Seed`。
- 设置：可切换静音、主题、Ghost、自动开局，并可填写分享 API 地址。
- 主题：支持 `经典`、`海洋`、`宝石`、`星空`、`极光`、`熔岩` 6 套整站皮肤；开始页可预览，设置面板可在对局中即时切换。
- 本地能力：每局会记录战绩和回放，可从菜单或结算页直接回看上一局。

## GitHub Pages 发布

1. 新建公开仓库 `RussianBlock`，并把当前项目推送到 `main` 分支。
2. 在 GitHub 仓库的 Pages 设置里把 Source 设为 `GitHub Actions`。
3. 推送后由 `.github/workflows/deploy-pages.yml` 自动发布 `dist/`。
4. 默认固定链接为 `https://<github-username>.github.io/RussianBlock/`。

## Cloudflare API

1. 用 `workers/schema.sql` 初始化 D1。
2. 在 `wrangler.toml` 里填入真实的 `database_id`。
3. 本地调试：

```powershell
npm run worker:dev
```

4. 部署：

```powershell
npm run worker:deploy
```

5. 前端设置里的 `API Base` 填你部署后的 Worker URL，就能启用挑战码、回放码和每日挑战入口。

## Android 使用

1. 用 Android Chrome 打开 GitHub Pages 固定链接。
2. 如果浏览器提示，可通过“添加到主屏幕”安装为 PWA。

## Sharing Updates

- Replay watch pages now expose direct actions for copying the replay link, turning that replay into a new challenge, exporting a share card, and replaying the same seed.
- Challenge and daily submissions now send the locally stored nickname when present, and the result screen surfaces the active target plus pass/fail status.
- Leaderboard requests now support current-submission context so the UI can keep your latest run visible even when it falls below the top five.
