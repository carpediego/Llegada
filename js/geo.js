const EARTH_RADIUS = 6371008.8;

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 5) * 5)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatAccuracy(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "precisión desconocida";
  return `±${Math.round(meters)} m`;
}

export function entryRadius(reminder) {
  return reminder.radius;
}

export function exitRadius(reminder, accuracy = 0) {
  const margin = Math.max(18, Math.min(90, Number(accuracy) || 0));
  return reminder.radius + margin;
}

export class LocationTracker {
  constructor({ onPosition, onStatus, onError } = {}) {
    this.onPosition = onPosition || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.watchId = null;
    this.active = false;
    this.lastPosition = null;
    this.permission = "unknown";
    this._startedAt = 0;
  }

  get supported() {
    return "geolocation" in navigator;
  }

  async getPermissionState() {
    if (!("permissions" in navigator)) return "unknown";
    try {
      const result = await navigator.permissions.query({ name: "geolocation" });
      this.permission = result.state;
      return result.state;
    } catch {
      return this.permission;
    }
  }

  start() {
    if (!this.supported) {
      this.onError(new Error("Este navegador no tiene geolocalización."), "unsupported");
      return false;
    }
    if (this.active) return true;
    this.active = true;
    this._startedAt = Date.now();
    this.onStatus({ state: "starting", position: this.lastPosition });

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this._handlePosition(position),
      (error) => this._handleError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 25000
      }
    );
    return true;
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.active = false;
    this.onStatus({ state: "off", position: this.lastPosition });
  }

  async locateOnce(options = {}) {
    if (!this.supported) throw new Error("Este navegador no tiene geolocalización.");
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const normalized = this._normalize(position);
          this.lastPosition = normalized;
          resolve(normalized);
        },
        (error) => reject(this._friendlyError(error)),
        {
          enableHighAccuracy: true,
          maximumAge: options.maximumAge ?? 15000,
          timeout: options.timeout ?? 25000
        }
      );
    });
  }

  _handlePosition(position) {
    const normalized = this._normalize(position);
    this.lastPosition = normalized;
    this.permission = "granted";
    this.onPosition(normalized);
    this.onStatus({
      state: normalized.accuracy > 120 ? "weak" : "active",
      position: normalized
    });
  }

  _handleError(error) {
    const friendly = this._friendlyError(error);
    if (error?.code === 1) {
      this.permission = "denied";
      this.stop();
      this.onError(friendly, "denied");
      return;
    }
    this.onError(friendly, error?.code === 3 ? "timeout" : "unavailable");
    this.onStatus({
      state: "error",
      error: friendly,
      position: this.lastPosition,
      code: error?.code
    });
  }

  _normalize(position) {
    const coords = position.coords;
    return {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: Number(coords.accuracy) || 0,
      altitude: coords.altitude,
      heading: coords.heading,
      speed: coords.speed,
      timestamp: position.timestamp || Date.now()
    };
  }

  _friendlyError(error) {
    const messages = {
      1: "Permiso de ubicación denegado. Actívalo en los ajustes del navegador.",
      2: "No se pudo obtener tu ubicación. Comprueba que el GPS esté encendido.",
      3: "La ubicación tardó demasiado en responder. Inténtalo de nuevo."
    };
    return new Error(messages[error?.code] || "No se pudo obtener tu ubicación.");
  }
}

export function positionAgeLabel(timestamp) {
  if (!timestamp) return "sin señal";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 8) return "ahora mismo";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}
