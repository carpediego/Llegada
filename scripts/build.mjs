import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "llegada.config.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;
const build = new Date().toISOString();
const repositoryUrl = `https://github.com/${config.repo}`;
const releaseUrl = `${repositoryUrl}/releases/tag/${tag}`;

const changelog = await fs.readFile(path.join(root, "CHANGELOG.md"), "utf8");
const release = parseRelease(changelog, version);
const notes = release.notes.length
  ? release.notes
  : ["Mejoras de estabilidad y rendimiento.", "Preparación para futuras actualizaciones."];
const releasedAt = release.date || build.slice(0, 10);

const copyTargets = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js",
  "assets",
  "vendor",
  "LICENSE"
];

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

for (const target of copyTargets) {
  await copyEntry(path.join(root, target), path.join(dist, target));
}

await fs.writeFile(path.join(dist, ".nojekyll"), "", "utf8");
await fs.writeFile(
  path.join(dist, "build-info.js"),
  `self.__LLEGADA_BUILD__ = Object.freeze(${JSON.stringify(
    {
      version,
      tag,
      build,
      releasedAt,
      channel: config.channel || "stable",
      name: config.name || "Llegada",
      repo: config.repo,
      repositoryUrl,
      pagesUrl: config.pagesUrl,
      releaseUrl
    },
    null,
    2
  )});\n`,
  "utf8"
);

const precache = (await listFiles(dist))
  .filter((file) => !isExcludedFromPrecache(file))
  .map(toPosix)
  .sort();

const swTemplate = await fs.readFile(path.join(root, "sw.template.js"), "utf8");
const sw = swTemplate
  .replaceAll("__APP_VERSION__", JSON.stringify(version))
  .replaceAll("__APP_BUILD__", JSON.stringify(build))
  .replaceAll("__PRECACHE__", JSON.stringify(precache, null, 2));
await fs.writeFile(path.join(dist, "sw.js"), sw, "utf8");

const updateFiles = (await listFiles(dist))
  .filter((file) => !isExcludedFromUpdate(file))
  .sort((a, b) => a.localeCompare(b));

const files = [];
let totalSize = 0;
for (const relative of updateFiles) {
  const absolute = path.join(dist, relative);
  const buffer = await fs.readFile(absolute);
  files.push({
    path: toPosix(relative),
    size: buffer.byteLength,
    sha256: sha256(buffer)
  });
  totalSize += buffer.byteLength;
}

const updateManifest = {
  version,
  tag,
  builtAt: build,
  fileCount: files.length,
  totalSize,
  files
};
await fs.writeFile(
  path.join(dist, "update.json"),
  `${JSON.stringify(updateManifest, null, 2)}\n`,
  "utf8"
);

const packageName = `llegada-${tag}.zip`;
const packageRelative = `downloads/${packageName}`;
const packagePath = path.join(dist, packageRelative);

const versionDocument = {
  version,
  tag,
  name: config.name || "Llegada",
  channel: config.channel || "stable",
  releasedAt,
  builtAt: build,
  repo: config.repo,
  repositoryUrl,
  pagesUrl: config.pagesUrl,
  releaseUrl,
  notes,
  package: {
    url: packageRelative,
    name: packageName,
    size: 0,
    sha256: ""
  },
  update: {
    manifest: "update.json",
    fileCount: files.length,
    totalSize
  }
};

await fs.writeFile(
  path.join(dist, "version.json"),
  `${JSON.stringify(versionDocument, null, 2)}\n`,
  "utf8"
);

let releaseNotes = [
  `# Llegada ${tag}`,
  "",
  `Publicado el ${releasedAt}.`,
  "",
  ...notes.map((note) => `- ${note}`),
  ""
].join("\n");
await fs.writeFile(path.join(dist, "release-notes.md"), releaseNotes, "utf8");

const zip = new AdmZip();
addFolderToZip(zip, dist, "");
await fs.mkdir(path.dirname(packagePath), { recursive: true });
zip.writeZip(packagePath);
const packageBuffer = await fs.readFile(packagePath);
versionDocument.package.size = packageBuffer.byteLength;
versionDocument.package.sha256 = sha256(packageBuffer);

await fs.writeFile(
  path.join(dist, "version.json"),
  `${JSON.stringify(versionDocument, null, 2)}\n`,
  "utf8"
);

releaseNotes += `\nPaquete: \`${packageName}\` (${formatBytes(packageBuffer.byteLength)})\n`;
await fs.writeFile(path.join(dist, "release-notes.md"), releaseNotes, "utf8");

console.log("");
console.log(`  Llegada ${tag} lista en dist/`);
console.log(`  Archivos: ${files.length} · ${formatBytes(totalSize)}`);
console.log(`  Paquete:  ${packageRelative} · ${formatBytes(packageBuffer.byteLength)}`);
console.log(`  SHA-256:  ${versionDocument.package.sha256}`);
console.log("");

function parseRelease(markdown, wantedVersion) {
  const blocks = markdown.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const [heading, ...rest] = block.split("\n");
    const match = heading.match(/^([0-9]+\.[0-9]+\.[0-9]+)(?:\s+[—–-]\s+(.+))?$/);
    if (!match || match[1] !== wantedVersion) continue;
    const notes = rest
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").trim());
    return { date: match[2]?.trim() || "", notes };
  }
  return { date: "", notes: [] };
}

async function copyEntry(source, destination) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source);
    for (const entry of entries) {
      await copyEntry(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  if (path.basename(source) === ".DS_Store") return;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function listFiles(directory, base = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const relative = path.join(base, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFiles(path.join(directory, entry.name), relative)));
    } else {
      found.push(relative);
    }
  }
  return found;
}

function addFolderToZip(zip, directory, base) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = toPosix(path.join(base, entry.name));
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "downloads") continue;
      addFolderToZip(zip, absolute, relative);
    } else {
      if (entry.name === "release-notes.md") continue;
      zip.addLocalFile(absolute, base, entry.name);
    }
  }
}

function isExcludedFromUpdate(file) {
  const normalized = toPosix(file);
  return (
    normalized === "version.json" ||
    normalized === "update.json" ||
    normalized === "release-notes.md" ||
    normalized.startsWith("downloads/")
  );
}

function isExcludedFromPrecache(file) {
  const normalized = toPosix(file);
  return (
    normalized === "version.json" ||
    normalized === "update.json" ||
    normalized === "sw.js" ||
    normalized === "release-notes.md" ||
    normalized === "LICENSE" ||
    normalized === ".nojekyll" ||
    normalized.startsWith("downloads/")
  );
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toPosix(file) {
  return file.split(path.sep).join("/");
}
