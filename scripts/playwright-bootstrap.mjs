import fs from "node:fs";
import { chromium } from "playwright";

function resolveSystemChromium() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const systemExecutable = resolveSystemChromium();

if (systemExecutable) {
  const originalLaunch = chromium.launch.bind(chromium);
  chromium.launch = async (options = {}) => {
    return originalLaunch({
      ...options,
      executablePath: options.executablePath ?? systemExecutable,
    });
  };
}
