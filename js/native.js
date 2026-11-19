const locateRequests = new Map();

export function isNativeApp() {
  return Boolean(
    typeof window !== "undefined" &&
      window.Android &&
      typeof window.Android.isNative === "function" &&
      window.Android.isNative()
  );
}

export function nativeStatus() {
  if (!isNativeApp()) return null;
  try {
    return JSON.parse(window.Android.getNativeStatus());
  } catch {
    return null;
  }
}

export function nativeVersion() {
  if (!isNativeApp()) return "";
  try {
    return window.Android.getVersionName();
  } catch {
    return "";
  }
}

export function syncNativeReminders(reminders) {
  if (!isNativeApp()) return;
  try {
    window.Android.syncReminders(JSON.stringify(reminders));
  } catch (error) {
    console.warn("No se pudo sincronizar con Android", error);
  }
}

export function resetNativeReminder(id) {
  if (!isNativeApp()) return;
  try {
    window.Android.resetReminder(id);
  } catch {
    // Ignore bridge errors.
  }
}

export function resolveNativeAlarm(id, action, minutes) {
  if (!isNativeApp()) return;
  try {
    window.Android.resolveAlarm(id, action, minutes);
  } catch {
    // Ignore bridge errors.
  }
}

export function requestNativePermissions() {
  if (!isNativeApp()) return;
  try {
    window.Android.requestPermissions();
  } catch {
    // Ignore bridge errors.
  }
}

export function requestNativeBackgroundLocation() {
  if (!isNativeApp()) return;
  try {
    window.Android.requestBackgroundLocation();
  } catch {
    // Ignore bridge errors.
  }
}

export function openNativeAppSettings() {
  if (!isNativeApp()) return;
  try {
    window.Android.openAppSettings();
  } catch {
    // Ignore bridge errors.
  }
}

export function requestNativeBatteryExemption() {
  if (!isNativeApp()) return;
  try {
    window.Android.requestIgnoreBatteryOptimizations();
  } catch {
    // Ignore bridge errors.
  }
}

export function downloadNativeApk(url, version) {
  if (!isNativeApp()) return false;
  try {
    window.Android.downloadAndInstallApk(url, version);
    return true;
  } catch {
    return false;
  }
}

export function consumeNativePendingAlarm() {
  if (!isNativeApp()) return "";
  try {
    return window.Android.consumePendingAlarm() || "";
  } catch {
    return "";
  }
}

export class NativeTracker {
  constructor({ onPosition, onStatus, onError } = {}) {
    this.onPosition = onPosition || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.lastPosition = null;
    this.permission = "unknown";
    this._onNativePosition = (event) => {
      const position = event.detail;
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
      this.lastPosition = position;
      this.permission = "granted";
      this.onPosition(position);
      this.onStatus({
        state: position.accuracy > 120 ? "weak" : "active",
        position
      });
    };
    this._onNativeStatus = (event) => {
      const detail = event.detail || {};
      if (detail.state === "off") {
        this.active = false;
        this.onStatus({ state: "off", position: this.lastPosition });
        return;
      }
      if (detail.state === "permission") {
        this.onError(new Error(detail.message || "Permiso de ubicación requerido."), "denied");
        return;
      }
      if (detail.state === "error") {
        this.onError(new Error(detail.message || "Sin señal de ubicación."), "unavailable");
        return;
      }
      if (detail.state === "weak") {
        this.onStatus({ state: "weak", position: this.lastPosition });
        return;
      }
      if (detail.state === "active") {
        this.active = true;
        this.permission = "granted";
        this.onStatus({ state: "active", position: this.lastPosition });
      }
    };
    this._onNativePermission = (event) => {
      const state = event.detail?.state || "unknown";
      this.permission = state;
      if (state === "denied") {
        this.onError(new Error("Permiso de ubicación denegado."), "denied");
      }
    };
    window.addEventListener("llegada:native-position", this._onNativePosition);
    window.addEventListener("llegada:native-status", this._onNativeStatus);
    window.addEventListener("llegada:native-permission", this._onNativePermission);
  }

  get supported() {
    return true;
  }

  async getPermissionState() {
    try {
      this.permission = window.Android.getPermissionState();
      return this.permission;
    } catch {
      return "unknown";
    }
  }

  start() {
    this.active = true;
    this.onStatus({ state: "starting", position: this.lastPosition });
    try {
      const result = window.Android.startTracking();
      if (result === "permission_required") {
        this.onStatus({ state: "starting", position: this.lastPosition });
      } else if (result === "started") {
        this.permission = "granted";
      }
      return true;
    } catch (error) {
      this.active = false;
      this.onError(error instanceof Error ? error : new Error(String(error)), "unavailable");
      return false;
    }
  }

  stop() {
    try {
      window.Android.stopTracking();
    } catch {
      // Ignore.
    }
    this.active = false;
    this.onStatus({ state: "off", position: this.lastPosition });
  }

  locateOnce() {
    return new Promise((resolve, reject) => {
      const requestId = `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timer = window.setTimeout(() => {
        locateRequests.delete(requestId);
        reject(new Error("La ubicación tardó demasiado en responder."));
      }, 25000);
      locateRequests.set(requestId, {
        resolve: (position) => {
          clearTimeout(timer);
          locateRequests.delete(requestId);
          this.lastPosition = position;
          resolve(position);
        },
        reject: (error) => {
          clearTimeout(timer);
          locateRequests.delete(requestId);
          reject(error);
        }
      });
      try {
        window.Android.locateOnce(requestId);
      } catch (error) {
        clearTimeout(timer);
        locateRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(`llegada:native-${name}`, { detail }));
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

window.LlegadaNative = {
  receivePosition(json) {
    const position = safeJson(json);
    if (position) dispatch("position", position);
  },
  receivePhase(json) {
    const phase = safeJson(json);
    if (phase) dispatch("phase", phase);
  },
  receiveAlarm(id) {
    if (id) dispatch("alarm", { id });
  },
  receiveStatus(json) {
    const status = safeJson(json);
    if (status) dispatch("status", status);
  },
  receivePermission(state) {
    dispatch("permission", { state });
  },
  receiveLocation(requestId, json) {
    const request = locateRequests.get(requestId);
    const position = safeJson(json);
    if (request && position) request.resolve(position);
  },
  receiveLocationError(requestId, message) {
    const request = locateRequests.get(requestId);
    if (request) request.reject(new Error(message || "No se pudo obtener la ubicación."));
  }
};

if (isNativeApp()) {
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || link.target !== "_blank") return;
      event.preventDefault();
      try {
        window.Android.openUrl(link.href);
      } catch {
        // Ignore.
      }
    },
    true
  );
}
