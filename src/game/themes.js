const THEME_ORDER = ["classic", "ocean", "gem", "starlight", "aurora", "lava"];
const PIECE_TYPES = ["I", "J", "L", "O", "S", "T", "Z"];

function createPieceStyles(material, palette) {
  return Object.fromEntries(
    PIECE_TYPES.map((type, index) => [
      type,
      {
        material,
        ...palette[index],
      },
    ])
  );
}

function clampAlpha(value) {
  return Math.max(0, Math.min(1, value));
}

function parseRgbColor(color) {
  const match = String(color ?? "")
    .trim()
    .match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([01]?(?:\.\d+)?))?\s*\)$/i);
  if (!match) {
    return null;
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : clampAlpha(Number(match[4])),
  };
}

function toRgba(color) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clampAlpha(color.a).toFixed(3)})`;
}

function normalizeGhostCanvas(canvas) {
  const parsedGhost = parseRgbColor(canvas.ghost) ?? { r: 255, g: 255, b: 255, a: 0.28 };
  const baseGhost = {
    ...parsedGhost,
    a: Math.max(parsedGhost.a, 0.28),
  };

  return {
    ...canvas,
    ghost: toRgba(baseGhost),
    ghostFill: canvas.ghostFill ?? toRgba({ ...baseGhost, a: Math.max(baseGhost.a * 0.7, 0.2) }),
    ghostStroke: canvas.ghostStroke ?? toRgba({ ...baseGhost, a: Math.max(baseGhost.a + 0.28, 0.58) }),
    ghostGlow: canvas.ghostGlow ?? toRgba({ ...baseGhost, a: Math.max(baseGhost.a * 1.05, 0.28) }),
  };
}

function createTheme(definition) {
  return {
    ...definition,
    canvas: normalizeGhostCanvas(definition.canvas),
    preview: {
      ...definition.preview,
      stops: definition.preview.stops.join(", "),
    },
  };
}

export const DEFAULT_THEME_ID = "classic";

const classicPieces = createPieceStyles("classic", [
  { fill: "#62d6f9", shade: "#1f7ca1", highlight: "#b4f1ff", edge: "#d9fbff", glow: "rgba(98, 214, 249, 0.34)", specular: "rgba(227, 250, 255, 0.72)" },
  { fill: "#7a8fff", shade: "#3443a8", highlight: "#c0ccff", edge: "#dbe1ff", glow: "rgba(122, 143, 255, 0.34)", specular: "rgba(236, 240, 255, 0.68)" },
  { fill: "#ffad48", shade: "#b15f1e", highlight: "#ffd8a4", edge: "#fff0d0", glow: "rgba(255, 173, 72, 0.34)", specular: "rgba(255, 246, 222, 0.66)" },
  { fill: "#ffd64f", shade: "#c08a18", highlight: "#fff1ab", edge: "#fff8cf", glow: "rgba(255, 214, 79, 0.36)", specular: "rgba(255, 250, 214, 0.68)" },
  { fill: "#69e28d", shade: "#258948", highlight: "#c5ffd3", edge: "#e7ffee", glow: "rgba(105, 226, 141, 0.34)", specular: "rgba(240, 255, 244, 0.66)" },
  { fill: "#c88dff", shade: "#6e33a0", highlight: "#ecd0ff", edge: "#f8ebff", glow: "rgba(200, 141, 255, 0.34)", specular: "rgba(251, 242, 255, 0.7)" },
  { fill: "#ff7e85", shade: "#aa3149", highlight: "#ffc7d0", edge: "#ffe9ee", glow: "rgba(255, 126, 133, 0.36)", specular: "rgba(255, 238, 240, 0.68)" },
]);

const oceanPieces = createPieceStyles("ocean", [
  { fill: "#7ef2ff", shade: "#1d8f9a", highlight: "#d7ffff", edge: "#ebffff", glow: "rgba(101, 236, 255, 0.36)", specular: "rgba(234, 255, 255, 0.78)" },
  { fill: "#79b4ff", shade: "#235594", highlight: "#d7ecff", edge: "#eff7ff", glow: "rgba(121, 180, 255, 0.34)", specular: "rgba(233, 245, 255, 0.72)" },
  { fill: "#ffb98f", shade: "#b1653b", highlight: "#ffe2cf", edge: "#fff1e7", glow: "rgba(255, 185, 143, 0.34)", specular: "rgba(255, 245, 236, 0.7)" },
  { fill: "#ffe6a9", shade: "#b9943d", highlight: "#fff6d6", edge: "#fffcea", glow: "rgba(255, 230, 169, 0.32)", specular: "rgba(255, 250, 223, 0.72)" },
  { fill: "#97ffd7", shade: "#2d9f76", highlight: "#defff0", edge: "#f2fff9", glow: "rgba(151, 255, 215, 0.34)", specular: "rgba(237, 255, 247, 0.74)" },
  { fill: "#d5b4ff", shade: "#6c4b96", highlight: "#f3e8ff", edge: "#fcf8ff", glow: "rgba(213, 180, 255, 0.34)", specular: "rgba(250, 245, 255, 0.72)" },
  { fill: "#ffa9c0", shade: "#a84c70", highlight: "#ffdce7", edge: "#fff1f4", glow: "rgba(255, 169, 192, 0.34)", specular: "rgba(255, 242, 246, 0.72)" },
]);

const gemPieces = createPieceStyles("gem", [
  { fill: "#58f4ff", shade: "#00778f", highlight: "#dfffff", edge: "#eeffff", glow: "rgba(88, 244, 255, 0.42)", specular: "rgba(240, 255, 255, 0.86)" },
  { fill: "#5c7eff", shade: "#152c8a", highlight: "#ced8ff", edge: "#edf1ff", glow: "rgba(92, 126, 255, 0.42)", specular: "rgba(242, 245, 255, 0.84)" },
  { fill: "#ff8d33", shade: "#922f00", highlight: "#ffd9b0", edge: "#fff0db", glow: "rgba(255, 141, 51, 0.42)", specular: "rgba(255, 245, 230, 0.82)" },
  { fill: "#ffe23b", shade: "#9a6900", highlight: "#fff7bf", edge: "#fffbe6", glow: "rgba(255, 226, 59, 0.4)", specular: "rgba(255, 250, 225, 0.84)" },
  { fill: "#47f29b", shade: "#007143", highlight: "#d1ffe9", edge: "#ebfff5", glow: "rgba(71, 242, 155, 0.4)", specular: "rgba(238, 255, 246, 0.84)" },
  { fill: "#bf69ff", shade: "#5c118f", highlight: "#eed7ff", edge: "#fbf0ff", glow: "rgba(191, 105, 255, 0.42)", specular: "rgba(252, 242, 255, 0.84)" },
  { fill: "#ff5972", shade: "#8c1231", highlight: "#ffd3db", edge: "#ffeef2", glow: "rgba(255, 89, 114, 0.42)", specular: "rgba(255, 242, 245, 0.84)" },
]);

const starlightPieces = createPieceStyles("starlight", [
  { fill: "#6dc8ff", shade: "#1b4f95", highlight: "#dff2ff", edge: "#f6fbff", glow: "rgba(109, 200, 255, 0.38)", specular: "rgba(244, 250, 255, 0.82)" },
  { fill: "#93a8ff", shade: "#33428f", highlight: "#dfe5ff", edge: "#f6f7ff", glow: "rgba(147, 168, 255, 0.38)", specular: "rgba(246, 247, 255, 0.82)" },
  { fill: "#ffb875", shade: "#92502a", highlight: "#ffe8cf", edge: "#fff6eb", glow: "rgba(255, 184, 117, 0.36)", specular: "rgba(255, 247, 238, 0.8)" },
  { fill: "#ffe37a", shade: "#9f7c22", highlight: "#fff6cf", edge: "#fffdf0", glow: "rgba(255, 227, 122, 0.36)", specular: "rgba(255, 250, 230, 0.8)" },
  { fill: "#8de4c0", shade: "#316f5b", highlight: "#e2fff5", edge: "#f3fffa", glow: "rgba(141, 228, 192, 0.36)", specular: "rgba(245, 255, 250, 0.82)" },
  { fill: "#d2a8ff", shade: "#6d438f", highlight: "#f6e9ff", edge: "#fef8ff", glow: "rgba(210, 168, 255, 0.38)", specular: "rgba(252, 246, 255, 0.82)" },
  { fill: "#ff9fb3", shade: "#8c3d56", highlight: "#ffe2e9", edge: "#fff4f7", glow: "rgba(255, 159, 179, 0.38)", specular: "rgba(255, 245, 248, 0.82)" },
]);

const auroraPieces = createPieceStyles("aurora", [
  { fill: "#64f6ff", shade: "#007887", highlight: "#deffff", edge: "#efffff", glow: "rgba(100, 246, 255, 0.38)", specular: "rgba(241, 255, 255, 0.82)" },
  { fill: "#80b7ff", shade: "#2754a4", highlight: "#daebff", edge: "#eff7ff", glow: "rgba(128, 183, 255, 0.36)", specular: "rgba(239, 247, 255, 0.8)" },
  { fill: "#ffb36e", shade: "#b45715", highlight: "#ffe4c8", edge: "#fff2e4", glow: "rgba(255, 179, 110, 0.36)", specular: "rgba(255, 245, 236, 0.8)" },
  { fill: "#fff07d", shade: "#b29118", highlight: "#fffac8", edge: "#fffde7", glow: "rgba(255, 240, 125, 0.34)", specular: "rgba(255, 251, 229, 0.8)" },
  { fill: "#7ff0c8", shade: "#1c8f66", highlight: "#ddfff1", edge: "#effff8", glow: "rgba(127, 240, 200, 0.36)", specular: "rgba(240, 255, 248, 0.82)" },
  { fill: "#df9cff", shade: "#7b39b0", highlight: "#f8e4ff", edge: "#fdf3ff", glow: "rgba(223, 156, 255, 0.36)", specular: "rgba(252, 245, 255, 0.82)" },
  { fill: "#ff8bb6", shade: "#b03a6c", highlight: "#ffdbe9", edge: "#fff0f6", glow: "rgba(255, 139, 182, 0.36)", specular: "rgba(255, 243, 248, 0.82)" },
]);

const lavaPieces = createPieceStyles("lava", [
  { fill: "#5cc3ff", shade: "#0f3f7e", highlight: "#dff0ff", edge: "#f4f9ff", glow: "rgba(92, 195, 255, 0.34)", specular: "rgba(243, 249, 255, 0.78)" },
  { fill: "#8f8cff", shade: "#352e9b", highlight: "#dedcff", edge: "#f5f4ff", glow: "rgba(143, 140, 255, 0.34)", specular: "rgba(245, 244, 255, 0.78)" },
  { fill: "#ff8c35", shade: "#8c2b00", highlight: "#ffd7b2", edge: "#fff0df", glow: "rgba(255, 140, 53, 0.44)", specular: "rgba(255, 243, 231, 0.82)" },
  { fill: "#ffd257", shade: "#926500", highlight: "#fff3bf", edge: "#fffbe4", glow: "rgba(255, 210, 87, 0.42)", specular: "rgba(255, 249, 222, 0.82)" },
  { fill: "#6ae2a2", shade: "#1f7a4d", highlight: "#dbffe8", edge: "#f2fff6", glow: "rgba(106, 226, 162, 0.34)", specular: "rgba(242, 255, 246, 0.8)" },
  { fill: "#d08bff", shade: "#6b2e96", highlight: "#efd8ff", edge: "#fbf0ff", glow: "rgba(208, 139, 255, 0.34)", specular: "rgba(251, 242, 255, 0.8)" },
  { fill: "#ff6d63", shade: "#8f1d18", highlight: "#ffd1cb", edge: "#ffefec", glow: "rgba(255, 109, 99, 0.46)", specular: "rgba(255, 241, 238, 0.84)" },
]);

export const THEMES = [
  createTheme({
    id: "classic",
    name: "经典",
    description: "蓝夜主机舱，保留原版科技感和暖色高光。",
    preview: {
      badge: "Neo Arcade",
      stops: ["#102749", "#183960", "#ffb347", "#7dd3fc"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#08101d",
      bg1: "#102033",
      panel: "rgba(11, 24, 39, 0.88)",
      panelBorder: "rgba(116, 170, 210, 0.28)",
      text: "#f3f6fb",
      muted: "#8da4ba",
      accent: "#ffb347",
      accentSoft: "#ffd7a0",
      chip: "rgba(13, 28, 44, 0.78)",
      buttonFrom: "#ffb347",
      buttonTo: "#ff8c42",
      buttonAlt: "rgba(255, 255, 255, 0.08)",
      stageFrom: "rgba(21, 40, 62, 0.74)",
      stageTo: "rgba(8, 16, 29, 0.86)",
      stageGlow: "rgba(125, 211, 252, 0.08)",
      stageBorder: "rgba(255, 255, 255, 0.06)",
      overlayScrim: "rgba(4, 10, 18, 0.44)",
      shadow: "0 20px 50px rgba(0, 0, 0, 0.35)",
    },
    canvas: {
      backgroundStart: "#0b1730",
      backgroundEnd: "#102033",
      shell: "rgba(4, 9, 17, 0.34)",
      shellBorder: "rgba(140, 192, 232, 0.14)",
      shellGlow: "rgba(125, 211, 252, 0.12)",
      board: "#07101b",
      boardGrid: "rgba(255, 255, 255, 0.08)",
      boardBorder: "rgba(125, 211, 252, 0.18)",
      panel: "rgba(13, 29, 46, 0.84)",
      panelBorder: "rgba(116, 170, 210, 0.28)",
      panelGlow: "rgba(255, 179, 71, 0.12)",
      textPrimary: "#f3f6fb",
      textMuted: "#8da4ba",
      accent: "#ffb347",
      accentSoft: "#ffd7a0",
      footer: "rgba(243, 246, 251, 0.72)",
      ghost: "rgba(255, 255, 255, 0.18)",
      pauseCurtain: "rgba(4, 8, 15, 0.48)",
      emptyText: "rgba(141, 164, 186, 0.85)",
      statsAccent: "#7dd3fc",
    },
    backdrop: {
      scene: "classic",
      primary: ["rgba(33, 73, 112, 0.34)", "rgba(24, 66, 95, 0.24)"],
      secondary: ["rgba(255, 179, 71, 0.08)", "rgba(125, 211, 252, 0.08)"],
    },
    pieces: classicPieces,
  }),
  createTheme({
    id: "ocean",
    name: "海洋",
    description: "深海蓝绿与珍珠冷光，方块像被海水包裹的半透明晶体。",
    preview: {
      badge: "Deep Tide",
      stops: ["#041922", "#0b5360", "#56d9f6", "#dff8ff"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#04131c",
      bg1: "#0c2f3d",
      panel: "rgba(5, 29, 38, 0.9)",
      panelBorder: "rgba(124, 229, 241, 0.22)",
      text: "#ebfbff",
      muted: "#89b8c2",
      accent: "#7ef2ff",
      accentSoft: "#d8ffff",
      chip: "rgba(7, 39, 51, 0.82)",
      buttonFrom: "#7ef2ff",
      buttonTo: "#26b4ca",
      buttonAlt: "rgba(216, 255, 255, 0.08)",
      stageFrom: "rgba(3, 27, 35, 0.78)",
      stageTo: "rgba(4, 19, 28, 0.9)",
      stageGlow: "rgba(126, 242, 255, 0.12)",
      stageBorder: "rgba(216, 255, 255, 0.08)",
      overlayScrim: "rgba(1, 12, 18, 0.42)",
      shadow: "0 22px 54px rgba(0, 23, 29, 0.4)",
    },
    canvas: {
      backgroundStart: "#03212b",
      backgroundEnd: "#0d3745",
      shell: "rgba(2, 20, 27, 0.42)",
      shellBorder: "rgba(126, 242, 255, 0.16)",
      shellGlow: "rgba(126, 242, 255, 0.16)",
      board: "#031118",
      boardGrid: "rgba(142, 235, 245, 0.09)",
      boardBorder: "rgba(126, 242, 255, 0.2)",
      panel: "rgba(6, 30, 38, 0.88)",
      panelBorder: "rgba(124, 229, 241, 0.24)",
      panelGlow: "rgba(176, 246, 255, 0.14)",
      textPrimary: "#ebfbff",
      textMuted: "#89b8c2",
      accent: "#7ef2ff",
      accentSoft: "#d8ffff",
      footer: "rgba(235, 251, 255, 0.74)",
      ghost: "rgba(184, 247, 255, 0.24)",
      pauseCurtain: "rgba(1, 10, 16, 0.46)",
      emptyText: "rgba(137, 184, 194, 0.88)",
      statsAccent: "#56d9f6",
    },
    backdrop: {
      scene: "ocean",
      primary: ["rgba(86, 217, 246, 0.16)", "rgba(126, 242, 255, 0.1)", "rgba(220, 248, 255, 0.08)"],
      secondary: ["rgba(255, 255, 255, 0.08)", "rgba(130, 247, 255, 0.06)"],
    },
    pieces: oceanPieces,
  }),
  createTheme({
    id: "gem",
    name: "宝石",
    description: "深色绒面底座配切面晶石，亮边和镜面反射更强。",
    preview: {
      badge: "Cut Prism",
      stops: ["#18081f", "#3d1149", "#bf69ff", "#58f4ff"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#120616",
      bg1: "#321038",
      panel: "rgba(28, 8, 34, 0.9)",
      panelBorder: "rgba(205, 128, 255, 0.22)",
      text: "#fcf4ff",
      muted: "#c0a3cf",
      accent: "#ffb04f",
      accentSoft: "#ffe5b4",
      chip: "rgba(41, 11, 48, 0.84)",
      buttonFrom: "#bf69ff",
      buttonTo: "#ff7bb5",
      buttonAlt: "rgba(255, 255, 255, 0.08)",
      stageFrom: "rgba(36, 10, 42, 0.8)",
      stageTo: "rgba(17, 6, 20, 0.9)",
      stageGlow: "rgba(191, 105, 255, 0.14)",
      stageBorder: "rgba(255, 255, 255, 0.07)",
      overlayScrim: "rgba(10, 4, 13, 0.42)",
      shadow: "0 24px 60px rgba(19, 6, 22, 0.46)",
    },
    canvas: {
      backgroundStart: "#1a0822",
      backgroundEnd: "#361147",
      shell: "rgba(21, 7, 26, 0.44)",
      shellBorder: "rgba(205, 128, 255, 0.16)",
      shellGlow: "rgba(88, 244, 255, 0.16)",
      board: "#100412",
      boardGrid: "rgba(255, 255, 255, 0.06)",
      boardBorder: "rgba(205, 128, 255, 0.24)",
      panel: "rgba(26, 8, 32, 0.88)",
      panelBorder: "rgba(205, 128, 255, 0.26)",
      panelGlow: "rgba(255, 123, 181, 0.14)",
      textPrimary: "#fcf4ff",
      textMuted: "#c0a3cf",
      accent: "#ffb04f",
      accentSoft: "#ffe5b4",
      footer: "rgba(252, 244, 255, 0.74)",
      ghost: "rgba(255, 212, 255, 0.24)",
      pauseCurtain: "rgba(12, 3, 14, 0.5)",
      emptyText: "rgba(192, 163, 207, 0.88)",
      statsAccent: "#58f4ff",
    },
    backdrop: {
      scene: "gem",
      primary: ["rgba(191, 105, 255, 0.14)", "rgba(88, 244, 255, 0.14)", "rgba(255, 123, 181, 0.1)"],
      secondary: ["rgba(255, 255, 255, 0.08)", "rgba(255, 232, 185, 0.08)"],
    },
    pieces: gemPieces,
  }),
  createTheme({
    id: "starlight",
    name: "星空",
    description: "深空蓝紫、冷白描边和星尘纹理，整体更冷静克制。",
    preview: {
      badge: "Night Field",
      stops: ["#090d20", "#172457", "#7abfff", "#f4fbff"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#070c1a",
      bg1: "#1a2758",
      panel: "rgba(11, 16, 37, 0.9)",
      panelBorder: "rgba(155, 184, 255, 0.2)",
      text: "#f4f7ff",
      muted: "#9eadd0",
      accent: "#a8c7ff",
      accentSoft: "#edf4ff",
      chip: "rgba(14, 22, 50, 0.84)",
      buttonFrom: "#7abfff",
      buttonTo: "#a48bff",
      buttonAlt: "rgba(255, 255, 255, 0.08)",
      stageFrom: "rgba(15, 21, 48, 0.8)",
      stageTo: "rgba(7, 11, 26, 0.92)",
      stageGlow: "rgba(168, 199, 255, 0.14)",
      stageBorder: "rgba(255, 255, 255, 0.07)",
      overlayScrim: "rgba(6, 8, 17, 0.42)",
      shadow: "0 22px 58px rgba(2, 7, 22, 0.42)",
    },
    canvas: {
      backgroundStart: "#0c1230",
      backgroundEnd: "#1b2652",
      shell: "rgba(8, 12, 28, 0.44)",
      shellBorder: "rgba(168, 199, 255, 0.14)",
      shellGlow: "rgba(255, 255, 255, 0.08)",
      board: "#060a1a",
      boardGrid: "rgba(181, 197, 255, 0.06)",
      boardBorder: "rgba(168, 199, 255, 0.24)",
      panel: "rgba(13, 19, 42, 0.88)",
      panelBorder: "rgba(155, 184, 255, 0.24)",
      panelGlow: "rgba(244, 251, 255, 0.1)",
      textPrimary: "#f4f7ff",
      textMuted: "#9eadd0",
      accent: "#a8c7ff",
      accentSoft: "#edf4ff",
      footer: "rgba(244, 247, 255, 0.74)",
      ghost: "rgba(228, 236, 255, 0.22)",
      pauseCurtain: "rgba(3, 6, 18, 0.5)",
      emptyText: "rgba(158, 173, 208, 0.88)",
      statsAccent: "#f4fbff",
    },
    backdrop: {
      scene: "starlight",
      primary: ["rgba(122, 191, 255, 0.12)", "rgba(164, 139, 255, 0.1)", "rgba(255, 255, 255, 0.1)"],
      secondary: ["rgba(255, 255, 255, 0.16)", "rgba(196, 219, 255, 0.12)"],
    },
    pieces: starlightPieces,
  }),
  createTheme({
    id: "aurora",
    name: "极光",
    description: "青绿与紫色流光扫过冷色背景，面板和方块都有丝带感。",
    preview: {
      badge: "Polar Veil",
      stops: ["#051620", "#0d3540", "#7ff0c8", "#df9cff"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#05141b",
      bg1: "#12303a",
      panel: "rgba(7, 25, 31, 0.9)",
      panelBorder: "rgba(132, 245, 214, 0.2)",
      text: "#eefbff",
      muted: "#98b7be",
      accent: "#7ff0c8",
      accentSoft: "#e0fff3",
      chip: "rgba(10, 32, 39, 0.84)",
      buttonFrom: "#7ff0c8",
      buttonTo: "#a980ff",
      buttonAlt: "rgba(255, 255, 255, 0.08)",
      stageFrom: "rgba(8, 28, 35, 0.82)",
      stageTo: "rgba(4, 16, 22, 0.92)",
      stageGlow: "rgba(223, 156, 255, 0.12)",
      stageBorder: "rgba(255, 255, 255, 0.07)",
      overlayScrim: "rgba(3, 11, 15, 0.4)",
      shadow: "0 22px 58px rgba(1, 15, 20, 0.42)",
    },
    canvas: {
      backgroundStart: "#071e26",
      backgroundEnd: "#133743",
      shell: "rgba(4, 18, 23, 0.42)",
      shellBorder: "rgba(132, 245, 214, 0.14)",
      shellGlow: "rgba(223, 156, 255, 0.12)",
      board: "#041017",
      boardGrid: "rgba(181, 255, 232, 0.06)",
      boardBorder: "rgba(132, 245, 214, 0.22)",
      panel: "rgba(7, 24, 30, 0.88)",
      panelBorder: "rgba(132, 245, 214, 0.24)",
      panelGlow: "rgba(223, 156, 255, 0.14)",
      textPrimary: "#eefbff",
      textMuted: "#98b7be",
      accent: "#7ff0c8",
      accentSoft: "#e0fff3",
      footer: "rgba(238, 251, 255, 0.74)",
      ghost: "rgba(201, 255, 237, 0.22)",
      pauseCurtain: "rgba(2, 11, 16, 0.48)",
      emptyText: "rgba(152, 183, 190, 0.86)",
      statsAccent: "#df9cff",
    },
    backdrop: {
      scene: "aurora",
      primary: ["rgba(127, 240, 200, 0.14)", "rgba(223, 156, 255, 0.12)", "rgba(100, 246, 255, 0.1)"],
      secondary: ["rgba(255, 255, 255, 0.08)", "rgba(224, 255, 243, 0.08)"],
    },
    pieces: auroraPieces,
  }),
  createTheme({
    id: "lava",
    name: "熔岩",
    description: "黑曜石外壳里有热浪和裂纹，高温高对比但保持可读性。",
    preview: {
      badge: "Molten Core",
      stops: ["#150807", "#37110d", "#ff8c35", "#ffd257"],
    },
    ui: {
      colorScheme: "dark",
      bg0: "#120707",
      bg1: "#32110d",
      panel: "rgba(27, 10, 8, 0.9)",
      panelBorder: "rgba(255, 143, 88, 0.2)",
      text: "#fff3ec",
      muted: "#caa696",
      accent: "#ff9a54",
      accentSoft: "#ffe0bd",
      chip: "rgba(39, 15, 12, 0.84)",
      buttonFrom: "#ff8c35",
      buttonTo: "#ff4f3d",
      buttonAlt: "rgba(255, 255, 255, 0.07)",
      stageFrom: "rgba(40, 13, 10, 0.82)",
      stageTo: "rgba(18, 7, 7, 0.94)",
      stageGlow: "rgba(255, 140, 53, 0.12)",
      stageBorder: "rgba(255, 255, 255, 0.06)",
      overlayScrim: "rgba(12, 4, 4, 0.44)",
      shadow: "0 24px 62px rgba(16, 5, 5, 0.48)",
    },
    canvas: {
      backgroundStart: "#210b09",
      backgroundEnd: "#39110d",
      shell: "rgba(20, 7, 6, 0.46)",
      shellBorder: "rgba(255, 143, 88, 0.16)",
      shellGlow: "rgba(255, 210, 87, 0.1)",
      board: "#120505",
      boardGrid: "rgba(255, 194, 152, 0.06)",
      boardBorder: "rgba(255, 143, 88, 0.2)",
      panel: "rgba(29, 10, 8, 0.88)",
      panelBorder: "rgba(255, 143, 88, 0.24)",
      panelGlow: "rgba(255, 210, 87, 0.12)",
      textPrimary: "#fff3ec",
      textMuted: "#caa696",
      accent: "#ff9a54",
      accentSoft: "#ffe0bd",
      footer: "rgba(255, 243, 236, 0.74)",
      ghost: "rgba(255, 215, 185, 0.22)",
      pauseCurtain: "rgba(10, 3, 3, 0.52)",
      emptyText: "rgba(202, 166, 150, 0.88)",
      statsAccent: "#ffd257",
    },
    backdrop: {
      scene: "lava",
      primary: ["rgba(255, 140, 53, 0.14)", "rgba(255, 79, 61, 0.12)", "rgba(255, 210, 87, 0.12)"],
      secondary: ["rgba(255, 243, 236, 0.06)", "rgba(255, 198, 150, 0.08)"],
    },
    pieces: lavaPieces,
  }),
];

const THEMES_BY_ID = Object.fromEntries(THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value) {
  return typeof value === "string" && THEME_ORDER.includes(value);
}

export function getTheme(themeId) {
  return THEMES_BY_ID[themeId] ?? THEMES_BY_ID[DEFAULT_THEME_ID];
}
