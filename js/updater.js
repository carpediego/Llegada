const BUILD = globalThis.__LLEGADA_BUILD__ || {};
const CURRENT_VERSION = BUILD.version || "0.0.0";
const REPO = BUILD.repo || "carpediego/Llegada";
const REPO_URL = `https://github.com/${REPO}`;
const RELEASES_URL = `${REPO_URL}/releases`;

export class UpdateManager {
  constructor() {
    this.currentVersion = CURRENT_VERSION;
    this.latest = null;
    this.checking = false;
  }

  get repositoryUrl() {
    return REPO_URL;
  }

  get releasesUrl() {
    return RELEASES_URL;
  }

  async check({ manual = false } = {}) {
    if (this.checking) return this.latest;
    this.checking = true;
    try {
      if (!navigator.onLine) throw new Error("No hay conexión a internet.");
      const versionUrl = new URL("version.json", document.baseURI);
      const manifest = await fetchJson(`${versionUrl.href}?t=${Date.now()}`);
      if (!manifest?.version || !isSemver(manifest.version)) {
        throw new Error("La información de versión no es válida.");
      }

      let release = null;
      try {
        release = await fetchLatestRelease();
      } catch {
        release = null;
      }

      const remoteVersion = manifest.version;
      const available = compareVersions(remoteVersion, CURRENT_VERSION) > 0;
      const releaseMatches = release && cleanTag(release.tag_name) === remoteVersion;
      const notes = normalizeNotes(manifest.notes, releaseMatches ? release.body : "");
      const packageUrl = resolvePackageUrl(manifest, release, availabilityFor(release, remoteVersion));

      this.latest = {
        currentVersion: CURRENT_VERSION,
        version: remoteVersion,
        available,
        installable: available && Boolean(manifest.update?.manifest),
        notes,
        releasedAt: manifest.releasedAt || release?.published_at || "",
        size: Number(manifest.update?.totalSize) || 0,
        fileCount: Number(manifest.update?.fileCount) || 0,
        packageUrl,
        releaseUrl: manifest.releaseUrl || (releaseMatches ? release.html_url : `${REPO_URL}/releases`),
        release,
        manifest,
        checkedAt: Date.now(),
        manual
      };
      return this.latest;
    } finally {
      this.checking = false;
    }
  }

  async install(update, onProgress = () => {}) {
    if (!update?.available) throw new Error("No hay una actualización disponible.");
    if (compareVersions(update.version, CURRENT_VERSION) <= 0) {
      throw new Error("La versión instalada ya está al día.");
    }
    if (!update.installable) {
      throw new Error("El paquete de esta versión aún no está publicado. Prueba de nuevo en unos minutos.");
    }
    if (!("caches" in window)) throw new Error("Este navegador no permite instalar paquetes offline.");
    if (!globalThis.crypto?.subtle) throw new Error("La verificación de seguridad necesita HTTPS o localhost.");

    const manifestUrl = new URL(update.manifest.update?.manifest || "update.json", document.baseURI);
    const manifest = await fetchJson(`${manifestUrl.href}?t=${Date.now()}`, { cache: "no-store" });
    if (manifest?.version !== update.version || !Array.isArray(manifest.files) || !manifest.files.length) {
      throw new Error("El paquete descargado no coincide con la versión anunciada.");
    }

    const stageName = `llegada-staging-${update.version}`;
    const stage = await caches.open(stageName);
    const total = manifest.files.length;
    let downloaded = 0;
    let totalBytes = 0;

    onProgress({
      phase: "download",
      completed: 0,
      total,
      percent: 2,
      label: "Descargando paquete…",
      detail: `${total} archivos · ${formatBytes(update.size || manifest.totalSize || 0)}`
    });

    for (const file of manifest.files) {
      if (!file?.path || !file.sha256) throw new Error("El manifiesto del paquete está incompleto.");
      const fileUrl = new URL(file.path, document.baseURI);
      fileUrl.searchParams.set("v", update.version);
      const response = await fetch(fileUrl.href, { cache: "no-store" });
      if (!response.ok) throw new Error(`No se pudo descargar ${file.path} (${response.status}).`);
      const buffer = await response.arrayBuffer();
      const digest = await sha256(buffer);
      if (digest !== file.sha256) {
        throw new Error(`El archivo ${file.path} no superó la verificación de integridad.`);
      }
      totalBytes += buffer.byteLength;
      downloaded += 1;

      const headers = new Headers();
      const contentType = response.headers.get("content-type");
      if (contentType) headers.set("Content-Type", contentType);
      const cleanUrl = new URL(file.path, document.baseURI);
      await stage.put(new Request(cleanUrl.href), new Response(buffer, { headers }));

      onProgress({
        phase: "verify",
        completed: downloaded,
        total,
        percent: Math.min(90, Math.round((downloaded / total) * 88) + 2),
        label: "Descargando y verificando…",
        detail: `${downloaded} de ${total} archivos · ${formatBytes(totalBytes)}`
      });
    }

    onProgress({
      phase: "install",
      completed: total,
      total,
      percent: 94,
      label: "Activando nueva versión…",
      detail: "Preparando el service worker y limpiando la versión anterior."
    });

    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key.startsWith("llegada-shell-") ||
            (key.startsWith("llegada-staging-") && key !== stageName)
        )
        .map((key) => caches.delete(key))
    );

    sessionStorage.setItem("llegada.just-updated", update.version);
    await activateServiceWorker();

    onProgress({
      phase: "reload",
      completed: total,
      total,
      percent: 100,
      label: "Listo. Reiniciando Llegada…",
      detail: "La nueva versión se abrirá en un instante."
    });

    await sleep(700);
    location.reload();
  }

  downloadPackage(update) {
    const url = update?.packageUrl;
    if (!url) return false;
    const link = document.createElement("a");
    link.href = url;
    link.download = update.manifest?.package?.name || `llegada-v${update.version}.zip`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`No se pudo consultar ${url} (${response.status}).`);
  return response.json();
}

async function fetchLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) throw new Error("GitHub no devolvió el último release.");
  return response.json();
}

function resolvePackageUrl(manifest, release, releaseIsNewer) {
  if (manifest.package?.url) {
    return new URL(manifest.package.url, document.baseURI).href;
  }
  if (releaseIsNewer) {
    const asset = release?.assets?.find((item) => /\.zip$/i.test(item.name));
    if (asset?.browser_download_url) return asset.browser_download_url;
  }
  return "";
}

function availabilityFor(release, manifestVersion) {
  return Boolean(release && compareVersions(cleanTag(release.tag_name), manifestVersion) > 0);
}

function normalizeNotes(notes, releaseBody) {
  if (Array.isArray(notes) && notes.length) {
    return notes.map((note) => stripMarkdown(String(note))).filter(Boolean).slice(0, 12);
  }
  const lines = String(releaseBody || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .map(stripMarkdown)
    .filter(Boolean)
    .slice(0, 12);
  return lines;
}

function stripMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function activateServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  let changed = false;
  const controllerChange = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5500);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        changed = true;
        clearTimeout(timer);
        resolve(true);
      },
      { once: true }
    );
  });

  try {
    await registration.update();
  } catch {
    // The staged cache can still serve the new version on reload.
  }

  let worker = registration.waiting || registration.installing;
  if (registration.installing) {
    worker = await waitForWorker(registration.installing, 9000);
  }
  if (worker && (worker.state === "installed" || worker.state === "activating" || worker.state === "activated")) {
    worker.postMessage({ type: "SKIP_WAITING" });
  }
  await controllerChange;
  return changed;
}

function waitForWorker(worker, timeout) {
  return new Promise((resolve) => {
    if (worker.state === "installed" || worker.state === "activated" || worker.state === "redundant") {
      resolve(worker);
      return;
    }
    const timer = setTimeout(() => resolve(worker), timeout);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" || worker.state === "activated" || worker.state === "redundant") {
        clearTimeout(timer);
        resolve(worker);
      }
    });
  });
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function compareVersions(a, b) {
  const left = String(a).split("-")[0].split(".").map((part) => Number(part) || 0);
  const right = String(b).split("-")[0].split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function cleanTag(tag) {
  return String(tag || "").replace(/^v/i, "");
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
