import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const assetsRoot = path.join(root, "android", "app", "src", "main", "assets", "www");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

if (!(await exists(path.join(dist, "index.html")))) {
  console.error("Falta dist/index.html. Ejecuta primero: npm run build");
  process.exit(1);
}

await fs.rm(assetsRoot, { recursive: true, force: true });
await fs.mkdir(assetsRoot, { recursive: true });

const targets = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "build-info.js",
  "sw.js",
  "js",
  "assets",
  "vendor"
];

for (const target of targets) {
  const source = path.join(dist, target);
  if (!(await exists(source))) continue;
  await copy(source, path.join(assetsRoot, target));
}

const [major = 1, minor = 0, patch = 0] = String(pkg.version)
  .split(".")
  .map((part) => Number(part) || 0);
const versionCode = major * 10000 + minor * 100 + patch;
const versionProperties = [
  `VERSION_NAME=${pkg.version}`,
  `VERSION_CODE=${versionCode}`,
  ""
].join("\n");
await fs.writeFile(path.join(root, "android", "version.properties"), versionProperties, "utf8");

console.log("");
console.log(`  Android listo: ${pkg.version} (versionCode ${versionCode})`);
console.log(`  Web assets: ${path.relative(root, assetsRoot)}`);
console.log("");

async function copy(source, destination) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      await copy(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
