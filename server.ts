import http from "http";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { app } from "./api/index.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distIndex = path.resolve(__dirname, "dist", "index.html");
const hasDist = fs.existsSync(distIndex);
const isProd = process.env.NODE_ENV === "production" || hasDist;

function getPort(): number {
  const portArgIndex = process.argv.indexOf("--port");
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const val = Number(process.argv[portArgIndex + 1]);
    if (!isNaN(val) && val > 0) return val;
  }
  return Number(process.env.PORT) || 3000;
}
const PORT = getPort();

async function startServer() {
  const httpServer = http.createServer(app);

  // Mount Vite middleware only in dev mode when dist does not exist
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: "0.0.0.0",
        port: PORT,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Daily Defense server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
