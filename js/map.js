const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const DEFAULT_CENTER = [-12.0464, -77.0428];

export class DashboardMap {
  constructor(element, options = {}) {
    if (!globalThis.L) throw new Error("El mapa no está disponible.");
    this.element = element;
    this.onSelect = options.onSelect || (() => {});
    this.userMarker = null;
    this.accuracyCircle = null;
    this.reminderLayers = new Map();
    this.selectedId = null;
    this.hasCentered = false;
    this.map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      minZoom: 3,
      maxZoom: 19,
      worldCopyJump: true
    }).setView(options.center || DEFAULT_CENTER, options.zoom || 13);
    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    this.tiles = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: ATTRIBUTION
    }).addTo(this.map);

    this.layerGroup = L.layerGroup().addTo(this.map);
    this.map.on("click", () => this.onSelect(null));
  }

  updateReminders(reminders) {
    this.layerGroup.clearLayers();
    this.reminderLayers.clear();
    this.tiles.setZIndex(0);

    reminders.forEach((reminder, index) => {
      const selected = reminder.id === this.selectedId;
      const paused = !reminder.enabled;
      const color = selected ? "#f47b5c" : paused ? "#8c9991" : "#1d5c46";
      const fill = selected ? "#f47b5c" : paused ? "#b8c1ba" : "#c8ef6b";

      const circle = L.circle([reminder.lat, reminder.lng], {
        radius: reminder.radius,
        color,
        weight: selected ? 2 : 1.4,
        opacity: paused ? 0.45 : 0.8,
        fillColor: fill,
        fillOpacity: selected ? 0.2 : 0.14,
        dashArray: paused ? "4 7" : null,
        interactive: true
      }).addTo(this.layerGroup);

      const marker = L.marker([reminder.lat, reminder.lng], {
        icon: L.divIcon({
          className: "place-marker-wrap",
          html: `<div class="place-marker ${paused ? "is-paused" : ""} ${selected ? "is-active" : ""}"><span>${index + 1}</span></div>`,
          iconSize: [31, 31],
          iconAnchor: [15, 30],
          popupAnchor: [0, -28]
        }),
        keyboard: true,
        title: reminder.title,
        riseOnHover: true
      }).addTo(this.layerGroup);

      marker.bindPopup(
        `<div class="map-popup"><strong>${escapeHtml(reminder.title)}</strong><span>${escapeHtml(reminder.placeName)} · ${formatRadius(reminder.radius)}</span></div>`,
        { closeButton: false, offset: [0, -2] }
      );

      const select = (event) => {
        L.DomEvent.stopPropagation(event);
        this.selectedId = reminder.id;
        this.onSelect(reminder.id);
      };
      marker.on("click", select);
      circle.on("click", select);

      this.reminderLayers.set(reminder.id, { marker, circle });
    });

    if (this.selectedId) {
      const layer = this.reminderLayers.get(this.selectedId);
      if (layer) layer.marker.openPopup();
    }
  }

  setUser(position, { center = false } = {}) {
    if (!position) return;
    const latlng = [position.lat, position.lng];

    if (!this.userMarker) {
      this.userMarker = L.marker(latlng, {
        icon: L.divIcon({
          className: "user-marker-wrap",
          html: `<div class="user-marker ${position.accuracy > 120 ? "is-approximate" : ""}"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(latlng);
      this.userMarker.setIcon(
        L.divIcon({
          className: "user-marker-wrap",
          html: `<div class="user-marker ${position.accuracy > 120 ? "is-approximate" : ""}"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      );
    }

    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle(latlng, {
        radius: Math.max(10, position.accuracy || 10),
        color: "#1d5c46",
        weight: 0,
        fillColor: "#1d5c46",
        fillOpacity: 0.08,
        interactive: false
      }).addTo(this.map);
    } else {
      this.accuracyCircle.setLatLng(latlng);
      this.accuracyCircle.setRadius(Math.max(10, position.accuracy || 10));
    }

    if (center || !this.hasCentered) {
      this.map.setView(latlng, center ? Math.max(this.map.getZoom(), 15) : 14, { animate: false });
      this.hasCentered = true;
    }
  }

  centerOnUser() {
    if (!this.userMarker) return false;
    this.map.flyTo(this.userMarker.getLatLng(), Math.max(this.map.getZoom(), 15), { duration: 0.7 });
    return true;
  }

  focusReminder(id, { fly = true } = {}) {
    const layer = this.reminderLayers.get(id);
    if (!layer) return;
    this.selectedId = id;
    const latlng = layer.circle.getLatLng();
    const targetZoom = Math.max(15, zoomForRadius(layer.circle.getRadius()));
    if (fly) this.map.flyTo(latlng, targetZoom, { duration: 0.65 });
    else this.map.setView(latlng, targetZoom, { animate: false });
    layer.marker.openPopup();
  }

  clearSelection() {
    this.selectedId = null;
    this.map.closePopup();
  }

  fitAll() {
    const points = [];
    if (this.userMarker) points.push(this.userMarker.getLatLng());
    for (const { marker } of this.reminderLayers.values()) points.push(marker.getLatLng());
    if (!points.length) return;
    if (points.length === 1) {
      this.map.flyTo(points[0], 15, { duration: 0.6 });
      return;
    }
    this.map.flyToBounds(L.latLngBounds(points).pad(0.28), { duration: 0.7, maxZoom: 15 });
  }

  invalidateSize() {
    this.map.invalidateSize({ animate: false });
  }
}

export class PickerMap {
  constructor(element, { lat, lng, radius, onChange } = {}) {
    if (!globalThis.L) throw new Error("El mapa no está disponible.");
    this.element = element;
    this.onChange = onChange || (() => {});
    this.radius = radius || 150;
    this.point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    this.hasPoint = Boolean(this.point);
    this.map = L.map(element, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
      minZoom: 3,
      maxZoom: 19
    }).setView(this.point ? [this.point.lat, this.point.lng] : DEFAULT_CENTER, this.point ? 15 : 13);

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(this.map);

    this.circle = L.circle(this.point ? [this.point.lat, this.point.lng] : DEFAULT_CENTER, {
      radius: this.radius,
      color: "#1d5c46",
      weight: 1.5,
      fillColor: "#c8ef6b",
      fillOpacity: 0.22
    }).addTo(this.map);

    this.marker = L.marker(this.point ? [this.point.lat, this.point.lng] : DEFAULT_CENTER, {
      draggable: true,
      autoPan: true,
      title: "Arrastra para mover el lugar"
    }).addTo(this.map);

    this.marker.on("dragend", () => {
      const latlng = this.marker.getLatLng();
      this.setPoint(latlng.lat, latlng.lng, { fromMarker: true });
    });

    this.map.on("click", (event) => {
      this.setPoint(event.latlng.lat, event.latlng.lng, { fromMap: true });
    });

    if (this.point) this.circle.setLatLng(this.point);
    else this.clearPoint();
  }

  setPoint(lat, lng, { fly = false, silent = false } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.point = { lat, lng };
    this.hasPoint = true;
    const latlng = [lat, lng];
    this.marker.setLatLng(latlng).setOpacity(1);
    this.circle.setLatLng(latlng).setStyle({ opacity: 1, fillOpacity: 0.22 });
    if (fly) this.map.flyTo(latlng, Math.max(this.map.getZoom(), 15), { duration: 0.65 });
    if (!silent) this.onChange({ ...this.point });
  }

  clearPoint() {
    this.point = null;
    this.hasPoint = false;
    this.marker.setOpacity(0);
    this.circle.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  setRadius(radius) {
    this.radius = radius;
    this.circle.setRadius(radius);
  }

  centerOn(lat, lng, zoom = 15) {
    this.map.flyTo([lat, lng], zoom, { duration: 0.7 });
  }

  invalidateSize() {
    this.map.invalidateSize({ animate: false });
  }

  reset(lat, lng, radius) {
    this.radius = radius;
    this.setPoint(lat, lng, { silent: true });
    this.circle.setRadius(radius);
    this.map.setView([lat, lng], 15, { animate: false });
  }
}

function zoomForRadius(radius) {
  if (radius <= 60) return 17;
  if (radius <= 150) return 16;
  if (radius <= 350) return 15;
  if (radius <= 700) return 14;
  return 13;
}

function formatRadius(radius) {
  return radius >= 1000 ? `${(radius / 1000).toFixed(1)} km` : `${radius} m`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
