import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static-server.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5173;

const server = await startStaticServer({ rootDir, port, host: "0.0.0.0" });
console.log(`Russian Block dev server: http://127.0.0.1:${port}`);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
