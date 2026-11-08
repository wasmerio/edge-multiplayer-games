import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveGame } from "../engine/server.js";

serveGame({ publicDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public") });
