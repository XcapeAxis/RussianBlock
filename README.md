# Russian Block

一个面向 Windows 浏览器和 Android 浏览器的单人俄罗斯方块 Web/PWA。安卓端以滑屏和轻触为主，仓库内置 GitHub Pages 静态发布工作流。

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

默认会执行引擎级烟雾测试、桌面键盘回归和安卓手势回归，并把截图与状态写到 `output/web-game/`。

## 操作说明

- 键盘：`A/D` 或左右键移动，`S` 或下方向键软降，`W` 或上方向键旋转，`Space` 硬降，`C` 暂存，`P` 暂停，`R` 重开，`F` 全屏。
- 触屏：左右滑移动，单击旋转，下拖并停留会软降，下甩会硬降，双击 Hold；顶部保留暂停和设置。
- 设置：可切换静音，Android 端首次联网后支持离线再玩。

## GitHub Pages 发布

1. 新建公开仓库 `RussianBlock`，并把当前项目推送到 `main` 分支。
2. 在 GitHub 仓库的 Pages 设置里把 Source 设为 `GitHub Actions`。
3. 推送后由 `.github/workflows/deploy-pages.yml` 自动发布 `dist/`。
4. 默认固定链接为 `https://<github-username>.github.io/RussianBlock/`。

## Android 使用

1. 用 Android Chrome 打开 GitHub Pages 固定链接。
2. 如果浏览器提示，可通过“添加到主屏幕”安装为 PWA。
