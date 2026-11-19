import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const tag = `v${pkg.version}`;
const apkPath = path.join(dist, "downloads", `llegada-${tag}.apk`);
const versionPath = path.join(dist, "version.json");

const apk = await fs.readFile(apkPath);
const version = JSON.parse(await fs.readFile(versionPath, "utf8"));
version.apk = {
  url: `downloads/llegada-${tag}.apk`,
  name: `llegada-${tag}.apk`,
  size: apk.byteLength,
  sha256: crypto.createHash("sha256").update(apk).digest("hex")
};
await fs.writeFile(versionPath, `${JSON.stringify(version, null, 2)}\n`, "utf8");

console.log(`APK final: ${version.apk.name} · ${version.apk.size} bytes`);
console.log(`SHA-256:  ${version.apk.sha256}`);
