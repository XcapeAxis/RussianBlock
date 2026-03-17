import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static-server.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = 4173;

const server = await startStaticServer({ rootDir, port });
console.log(`Russian Block preview server: http://127.0.0.1:${port}`);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
