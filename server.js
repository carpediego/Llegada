import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".zip", "application/zip"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("No existe dist/index.html. Ejecuta primero: npm run build");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, app: "llegada" }));
      return;
    }

    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const resolved = path.resolve(root, `.${pathname}`);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      sendText(res, 403, "Acceso denegado");
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      sendText(res, 404, "No encontrado");
      return;
    }

    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.html");
      try {
        stat = await fsp.stat(indexPath);
        return serveFile(req, res, indexPath, stat);
      } catch {
        sendText(res, 404, "No encontrado");
        return;
      }
    }

    return serveFile(req, res, resolved, stat);
  } catch (error) {
    console.error(error);
    sendText(res, 500, "Error interno");
  }
});

function serveFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME.get(ext) || "application/octet-stream";
  const noCache = [".html", ".json", ".webmanifest", ".js"].includes(ext) && !filePath.includes(`${path.sep}downloads${path.sep}`);
  const headers = {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": noCache ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };
  if (type === "application/zip") {
    headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

server.listen(port, host, () => {
  console.log("");
  console.log(`  Llegada está en http://${host}:${port}`);
  console.log("  Pulsa Ctrl+C para detener el servidor.");
  console.log("");
});
