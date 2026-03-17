import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");

function resetDir(targetDir) {
  fs.rmSync(targetDir, { force: true, recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

export function buildProject({ outDir = distDir } = {}) {
  resetDir(outDir);
  copyFile(path.join(rootDir, "index.html"), path.join(outDir, "index.html"));
  copyDirectory(path.join(rootDir, "src"), path.join(outDir, "src"));
  if (fs.existsSync(path.join(rootDir, "public"))) {
    copyDirectory(path.join(rootDir, "public"), outDir);
  }
}

buildProject();
console.log("Build completed in dist/");
