const STORAGE_KEY = "llegada.state.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  trackingEnabled: false,
  defaultSnooze: 10,
  keepAwake: true,
  autoUpdateCheck: true,
  notificationsDismissed: false,
  lastUpdateCheckAt: 0
});

export function createReminderId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    reminders: [],
    lastPosition: null
  };
}

export function loadState() {
  const fallback = createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;

    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    settings.defaultSnooze = clampNumber(settings.defaultSnooze, 1, 120, 10);
    settings.lastUpdateCheckAt = Number(settings.lastUpdateCheckAt) || 0;

    const reminders = Array.isArray(parsed.reminders)
      ? parsed.reminders.map(normalizeReminder).filter(Boolean)
      : [];

    return {
      version: 1,
      settings,
      reminders,
      lastPosition: normalizePosition(parsed.lastPosition)
    };
  } catch (error) {
    console.warn("No se pudo leer el estado guardado", error);
    return fallback;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn("No se pudo guardar el estado", error);
    return false;
  }
}

export function normalizeReminder(input) {
  if (!input || typeof input !== "object") return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const phase = ["idle", "waiting", "snoozed", "ringing", "done"].includes(input.phase)
    ? input.phase
    : "idle";

  return {
    id: String(input.id || createReminderId()),
    title: clampText(input.title, 80, "Recordatorio"),
    note: clampText(input.note, 240, ""),
    placeName: clampText(input.placeName, 60, "Lugar"),
    lat: clampNumber(lat, -90, 90, 0),
    lng: clampNumber(lng, -180, 180, 0),
    radius: clampNumber(input.radius, 30, 1000, 150),
    trigger: input.trigger === "exit" ? "exit" : "enter",
    delayMin: clampNumber(input.delayMin, 0, 180, 0),
    requireStay: input.requireStay !== false,
    repeat: Boolean(input.repeat),
    sound: input.sound !== false,
    vibrate: input.vibrate !== false,
    enabled: input.enabled !== false,
    inside: typeof input.inside === "boolean" ? input.inside : null,
    phase,
    pendingUntil: finiteOrNull(input.pendingUntil),
    pendingDirection: input.pendingDirection === "exit" ? "exit" : "enter",
    snoozedUntil: finiteOrNull(input.snoozedUntil),
    lastFiredAt: finiteOrNull(input.lastFiredAt),
    fireCount: Math.max(0, Number(input.fireCount) || 0),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now()
  };
}

export function createReminder(data) {
  const now = Date.now();
  return normalizeReminder({
    id: createReminderId(),
    createdAt: now,
    updatedAt: now,
    phase: "idle",
    inside: null,
    ...data
  });
}

export function exportState(state) {
  return {
    app: "Llegada",
    exportedAt: new Date().toISOString(),
    state
  };
}

export function serializeImport(document) {
  if (!document || typeof document !== "object") throw new Error("El archivo no parece una copia de Llegada.");
  const raw = document.state && typeof document.state === "object" ? document.state : document;
  if (!Array.isArray(raw.reminders)) throw new Error("La copia no contiene recordatorios válidos.");
  const reminders = raw.reminders.map(normalizeReminder).filter(Boolean);
  if (!reminders.length && raw.reminders.length) throw new Error("Los recordatorios de la copia no son válidos.");
  return {
    reminders,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }
  };
}

function normalizePosition(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    accuracy: clampNumber(value.accuracy, 0, 100000, 0),
    timestamp: Number(value.timestamp) || Date.now()
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampText(value, max, fallback) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || fallback;
}
