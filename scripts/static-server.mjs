import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function resolveFile(rootDir, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const target = path.resolve(rootDir, `.${pathname}`);
  if (!target.startsWith(path.resolve(rootDir))) {
    return null;
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return target;
  }

  const fallback = path.resolve(rootDir, "index.html");
  return fs.existsSync(fallback) ? fallback : null;
}

export function startStaticServer({ rootDir, port, host = "127.0.0.1" }) {
  const server = createServer((request, response) => {
    const filePath = resolveFile(rootDir, request.url ?? "/");
    if (!filePath) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
    fs.createReadStream(filePath)
      .on("error", () => {
        response.statusCode = 500;
        response.end("Read error");
      })
      .pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}
