import {
  loadState,
  saveState,
  createReminder,
  exportState,
  serializeImport
} from "./store.js";
import {
  LocationTracker,
  distanceMeters,
  formatDistance,
  formatAccuracy,
  positionAgeLabel
} from "./geo.js";
import { DashboardMap, PickerMap } from "./map.js";
import { AlarmPlayer } from "./audio.js";
import {
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  showReminderNotification,
  closeReminderNotification,
  formatTrigger
} from "./notifications.js";
import { UpdateManager } from "./updater.js";

const BUILD = globalThis.__LLEGADA_BUILD__ || {
  version: "0.0.0",
  repo: "carpediego/Llegada",
  repositoryUrl: "https://github.com/carpediego/Llegada",
  releaseUrl: "https://github.com/carpediego/Llegada/releases",
  pagesUrl: ""
};
const DEFAULT_CENTER = { lat: -12.0464, lng: -77.0428 };
const FILTERS = ["all", "active", "paused"];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = loadState();
const tracker = new LocationTracker({
  onPosition: handlePosition,
  onStatus: handleTrackerStatus,
  onError: handleTrackerError
});
const alarm = new AlarmPlayer();
const updater = new UpdateManager();

const ui = {
  filter: "all",
  editingId: null,
  picker: null,
  pickerPoint: null,
  dashboardMap: null,
  selectedId: null,
  activeAlarm: null,
  trackerStatus: "off",
  trackerError: "",
  trackerPermission: "unknown",
  distances: new Map(),
  saveTimer: null,
  deferredInstall: null,
  updateInfo: null,
  recoveredRinging: []
};

let wakeLock = null;

const els = {
  trackingPill: $("#tracking-pill"),
  trackingLabel: $("#tracking-label"),
  notificationButton: $("#notification-button"),
  notificationDot: $("#notification-dot"),
  settingsButton: $("#settings-button"),
  updateDot: $("#update-dot"),
  newReminderButton: $("#new-reminder-button"),
  permissionBanner: $("#permission-banner"),
  enableNotifications: $("#enable-notifications"),
  dismissNotifications: $("#dismiss-notifications"),
  reminderCount: $("#reminder-count"),
  reminderList: $("#reminder-list"),
  emptyState: $("#empty-state"),
  filterTabs: $$(".filter-tab"),
  mapPanel: $(".map-panel"),
  dashboardMap: $("#dashboard-map"),
  mapPlaceholder: $("#map-placeholder"),
  mapActivate: $("#map-activate"),
  mapLocate: $("#map-locate"),
  gpsIndicator: $("#gps-indicator"),
  gpsTitle: $("#gps-title"),
  gpsSubtitle: $("#gps-subtitle"),
  gpsAction: $("#gps-action"),
  accuracyLabel: $("#accuracy-label"),
  reminderDialog: $("#reminder-dialog"),
  reminderForm: $("#reminder-form"),
  reminderDialogEyebrow: $("#reminder-dialog-eyebrow"),
  reminderDialogTitle: $("#reminder-dialog-title"),
  fieldTitle: $("#field-title"),
  fieldNote: $("#field-note"),
  fieldPlace: $("#field-place"),
  fieldRadius: $("#field-radius"),
  radiusOutput: $("#radius-output"),
  radiusPill: $("#radius-pill"),
  coordsLine: $("#coords-line"),
  placeSearch: $("#place-search"),
  placeSearchButton: $("#place-search-button"),
  searchResults: $("#search-results"),
  pickerMap: $("#picker-map"),
  useCurrentLocation: $("#use-current-location"),
  fieldDelay: $("#field-delay"),
  delayPresets: $("#delay-presets"),
  delayCustomWrap: $("#delay-custom-wrap"),
  delayReadout: $("#delay-readout"),
  delayHelper: $("#delay-helper"),
  requireStayRow: $("#require-stay-row"),
  fieldRepeat: $("#field-repeat"),
  fieldRequireStay: $("#field-require-stay"),
  fieldSound: $("#field-sound"),
  fieldVibrate: $("#field-vibrate"),
  advancedSettings: $("#advanced-settings"),
  formError: $("#form-error"),
  deleteReminder: $("#delete-reminder"),
  saveReminder: $("#save-reminder"),
  saveReminderLabel: $("#save-reminder-label"),
  settingsDialog: $("#settings-dialog"),
  settingSnooze: $("#setting-snooze"),
  settingWakeLock: $("#setting-wake-lock"),
  settingAutoUpdate: $("#setting-auto-update"),
  geolocationStatus: $("#geolocation-status"),
  notificationsStatus: $("#notifications-status"),
  settingsNotifications: $("#settings-notifications"),
  installButton: $("#install-button"),
  limitsButton: $("#limits-button"),
  exportButton: $("#export-button"),
  importButton: $("#import-button"),
  importFile: $("#import-file"),
  clearData: $("#clear-data"),
  infoDialog: $("#info-dialog"),
  alarmDialog: $("#alarm-dialog"),
  alarmTitle: $("#alarm-title"),
  alarmPlace: $("#alarm-place"),
  alarmNote: $("#alarm-note"),
  alarmTime: $("#alarm-time"),
  alarmSnooze: $("#alarm-snooze"),
  snoozeOptions: $("#snooze-options"),
  alarmDone: $("#alarm-done"),
  alarmTestClose: $("#alarm-test-close"),
  currentVersion: $("#current-version"),
  githubLink: $("#github-link"),
  updateStatus: $("#update-status"),
  checkUpdates: $("#check-updates"),
  showUpdate: $("#show-update"),
  downloadPackage: $("#download-package"),
  updateHelpButton: $("#update-help-button"),
  updateDialog: $("#update-dialog"),
  updateFromVersion: $("#update-from-version"),
  updateToVersion: $("#update-to-version"),
  updateSize: $("#update-size"),
  updateDate: $("#update-date"),
  updateNotesList: $("#update-notes-list"),
  updateNotesEmpty: $("#update-notes-empty"),
  updateError: $("#update-error"),
  releaseLink: $("#release-link"),
  downloadPackageDialog: $("#download-package-dialog"),
  installUpdate: $("#install-update"),
  installProgress: $("#install-progress"),
  installProgressLabel: $("#install-progress-label"),
  installProgressPercent: $("#install-progress-percent"),
  installProgressBar: $("#install-progress-bar"),
  installProgressDetail: $("#install-progress-detail"),
  footerPrivacy: $("#footer-privacy"),
  toastStack: $("#toast-stack")
};

init().catch((error) => {
  console.error("No se pudo iniciar Llegada", error);
  showToast("No se pudo iniciar la app. Recarga la página.", { type: "error", duration: 7000 });
});

async function init() {
  setBuildInfo();
  repairState();
  bindEvents();
  updateSettingsUI();
  updateNotificationUI();
  renderReminders();
  updateGpsUI();
  startClock();
  await setupDashboardMap();
  if (state.lastPosition && ui.dashboardMap) {
    ui.dashboardMap.setUser(state.lastPosition, { center: true });
  }
  await restoreTracking();
  registerServiceWorker();
  handleQueryParams();
  restoreRecoveredAlarms();
  maybeAutoUpdateCheck();
  updateNotificationUI();

  const justUpdated = sessionStorage.getItem("llegada.just-updated");
  if (justUpdated) {
    sessionStorage.removeItem("llegada.just-updated");
    showToast(`Llegada actualizada a v${justUpdated}.`, { type: "success", duration: 5000 });
  }
}

function setBuildInfo() {
  els.currentVersion.textContent = `v${BUILD.version}`;
  els.githubLink.href = BUILD.repositoryUrl;
  els.releaseLink.href = BUILD.releaseUrl;
  els.updateFromVersion.textContent = BUILD.version;
  els.updateToVersion.textContent = BUILD.version;
  const versionLine = $(".settings-version");
  if (versionLine) versionLine.textContent = `Llegada · v${BUILD.version} · GitHub Pages`;
}

function repairState() {
  const now = Date.now();
  let changed = false;
  for (const reminder of state.reminders) {
    if (reminder.phase === "ringing") {
      if (reminder.lastFiredAt && now - reminder.lastFiredAt < 15 * 60 * 1000) {
        ui.recoveredRinging.push(reminder.id);
      } else {
        reminder.phase = "idle";
        changed = true;
      }
    }
    if (reminder.phase === "waiting") {
      if (!reminder.pendingUntil || now - reminder.pendingUntil > 2 * 60 * 60 * 1000) {
        reminder.phase = "idle";
        reminder.pendingUntil = null;
        changed = true;
      }
    }
    if (reminder.phase === "snoozed") {
      if (!reminder.snoozedUntil || now - reminder.snoozedUntil > 2 * 60 * 60 * 1000) {
        reminder.phase = "idle";
        reminder.snoozedUntil = null;
        changed = true;
      }
    }
    if (reminder.enabled && reminder.phase === "done") {
      reminder.phase = "idle";
      changed = true;
    }
  }
  if (changed) saveState(state);
}

function bindEvents() {
  $("#new-reminder-button").addEventListener("click", () => openReminderDialog());
  $$("[data-open-new]").forEach((button) => button.addEventListener("click", () => openReminderDialog()));
  $$(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      openReminderDialog(null, {
        title: button.dataset.suggestion || "",
        placeName: button.dataset.place || ""
      });
    });
  });

  els.trackingPill.addEventListener("click", toggleTracking);
  els.mapActivate.addEventListener("click", () => enableTracking({ userInitiated: true }));
  els.gpsAction.addEventListener("click", () => {
    if (state.settings.trackingEnabled) {
      tracker.stop();
      enableTracking({ userInitiated: true });
    } else {
      enableTracking({ userInitiated: true });
    }
  });
  els.mapLocate.addEventListener("click", () => {
    if (ui.dashboardMap?.centerOnUser()) return;
    if (!state.settings.trackingEnabled) enableTracking({ userInitiated: true });
    else if (tracker.active) tracker.locateOnce().then((position) => {
      if (ui.dashboardMap) ui.dashboardMap.setUser(position, { center: true });
    }).catch((error) => showToast(error.message, { type: "error" }));
  });

  els.filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!FILTERS.includes(tab.dataset.filter)) return;
      ui.filter = tab.dataset.filter;
      els.filterTabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderReminders();
    });
  });

  els.reminderList.addEventListener("click", (event) => {
    const card = event.target.closest(".reminder-card");
    if (!card) return;
    const reminder = findReminder(card.dataset.id);
    if (!reminder) return;
    if (event.target.closest("[data-toggle]")) {
      event.stopPropagation();
      toggleReminder(reminder);
      return;
    }
    if (event.target.closest("[data-test]")) {
      event.stopPropagation();
      testReminder(reminder);
      return;
    }
    openReminderDialog(reminder);
  });

  els.reminderList.addEventListener("keydown", (event) => {
    const card = event.target.closest(".reminder-card");
    if (!card || event.target.closest("button")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const reminder = findReminder(card.dataset.id);
      if (reminder) openReminderDialog(reminder);
    }
  });

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = button.closest("dialog");
      if (dialog?.open) dialog.close();
    });
  });

  [els.reminderDialog, els.settingsDialog, els.infoDialog, els.updateDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  els.reminderForm.addEventListener("submit", handleReminderSubmit);
  els.fieldRadius.addEventListener("input", () => {
    const radius = Number(els.fieldRadius.value);
    els.radiusOutput.value = `${radius} m`;
    els.radiusPill.textContent = formatRadius(radius);
    ui.picker?.setRadius(radius);
    updateCoordsLine();
  });
  $$('input[name="trigger"]', els.reminderForm).forEach((input) => {
    input.addEventListener("change", updateDelayUI);
  });
  els.delayPresets.addEventListener("click", (event) => {
    const chip = event.target.closest(".delay-chip");
    if (!chip) return;
    const value = chip.dataset.delay;
    if (value === "custom") {
      els.delayCustomWrap.hidden = false;
      els.fieldDelay.focus();
      els.fieldDelay.select();
      return;
    }
    setDelayValue(Number(value));
  });
  els.fieldDelay.addEventListener("input", () => {
    const value = clamp(Number(els.fieldDelay.value) || 0, 0, 180);
    els.fieldDelay.value = String(value);
    updateDelayUI();
  });
  els.placeSearchButton.addEventListener("click", searchPlaces);
  els.placeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlaces();
    }
    if (event.key === "Escape") els.searchResults.hidden = true;
  });
  els.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest(".search-result");
    if (button) selectSearchResult(button);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".place-search")) els.searchResults.hidden = true;
  });
  els.useCurrentLocation.addEventListener("click", useCurrentLocationInForm);
  els.deleteReminder.addEventListener("click", deleteCurrentReminder);
  els.reminderDialog.addEventListener("close", () => {
    ui.editingId = null;
    els.searchResults.hidden = true;
  });

  els.settingsButton.addEventListener("click", openSettings);
  els.notificationButton.addEventListener("click", openSettings);
  els.settingSnooze.addEventListener("change", () => {
    state.settings.defaultSnooze = clamp(Number(els.settingSnooze.value) || 10, 1, 120);
    saveState(state);
  });
  els.settingWakeLock.addEventListener("change", () => {
    state.settings.keepAwake = els.settingWakeLock.checked;
    saveState(state);
    if (state.settings.keepAwake && state.settings.trackingEnabled) acquireWakeLock();
    else releaseWakeLock();
  });
  els.settingAutoUpdate.addEventListener("change", () => {
    state.settings.autoUpdateCheck = els.settingAutoUpdate.checked;
    saveState(state);
  });
  els.settingsNotifications.addEventListener("click", requestNotifications);
  els.enableNotifications.addEventListener("click", requestNotifications);
  els.dismissNotifications.addEventListener("click", () => {
    state.settings.notificationsDismissed = true;
    saveState(state);
    updateNotificationUI();
  });
  els.installButton.addEventListener("click", installApp);
  els.limitsButton.addEventListener("click", showInfoDialog);
  els.updateHelpButton.addEventListener("click", showInfoDialog);
  els.footerPrivacy.addEventListener("click", showInfoDialog);

  els.exportButton.addEventListener("click", exportData);
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importData);
  els.clearData.addEventListener("click", clearAllData);

  els.checkUpdates.addEventListener("click", () => checkForUpdates({ manual: true }));
  els.showUpdate.addEventListener("click", openUpdateDialog);
  els.downloadPackage.addEventListener("click", () => downloadPackage(ui.updateInfo));
  els.downloadPackageDialog.addEventListener("click", () => downloadPackage(ui.updateInfo));
  els.installUpdate.addEventListener("click", installUpdate);
  els.updateDialog.addEventListener("close", () => {
    if (ui.activeAlarm) return;
  });

  els.snoozeOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-snooze]");
    if (!button) return;
    dismissAlarm("snooze", Number(button.dataset.snooze));
  });
  els.alarmDone.addEventListener("click", () => dismissAlarm("done"));
  els.alarmTestClose.addEventListener("click", () => dismissAlarm("test"));
  els.alarmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (ui.activeAlarm?.test) dismissAlarm("test");
  });

  document.addEventListener("pointerdown", () => {
    alarm.unlock().catch(() => {});
  }, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.settings.trackingEnabled && !tracker.active) {
        tracker.start();
      }
      acquireWakeLock();
      tick();
    } else {
      saveState(state);
    }
  });

  window.addEventListener("pagehide", () => {
    saveState(state);
    releaseWakeLock();
  });
  window.addEventListener("online", () => {
    els.updateStatus.textContent = "Conexión recuperada. Puedes buscar actualizaciones.";
    if (state.settings.autoUpdateCheck) maybeAutoUpdateCheck({ force: true });
  });
  window.addEventListener("offline", () => {
    if (ui.updateInfo) return;
    els.updateStatus.textContent = "Sin conexión. La app sigue funcionando con lo guardado.";
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    ui.deferredInstall = event;
    els.installButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    ui.deferredInstall = null;
    els.installButton.hidden = true;
    showToast("Llegada se instaló en tu dispositivo.", { type: "success" });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "NOTIFICATION_CLICK") {
        handleNotificationClick(event.data.reminderId);
      }
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (ui.activeAlarm) return;
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.searchResults && !els.searchResults.hidden) {
      els.searchResults.hidden = true;
    }
  });

  if (isIos() && !isStandalone()) {
    els.installButton.hidden = false;
  }
}

async function setupDashboardMap() {
  const ready = await waitForLeaflet();
  if (!ready) {
    els.mapPlaceholder.hidden = false;
    $("strong", els.mapPlaceholder).textContent = "El mapa no cargó";
    $("p", els.mapPlaceholder).textContent = "Puedes seguir creando recordatorios con tu ubicación actual.";
    return;
  }
  try {
    ui.dashboardMap = new DashboardMap(els.dashboardMap, {
      center: state.lastPosition ? [state.lastPosition.lat, state.lastPosition.lng] : undefined,
      zoom: state.lastPosition ? 14 : 13,
      onSelect: (id) => {
        ui.selectedId = id;
        updateSelectedCard();
      }
    });
    ui.dashboardMap.updateReminders(state.reminders);
    if (state.lastPosition) {
      ui.dashboardMap.setUser(state.lastPosition, { center: true });
      els.mapPanel.classList.add("has-map");
    }
    window.setTimeout(() => ui.dashboardMap?.invalidateSize(), 200);
  } catch (error) {
    console.warn("Mapa no disponible", error);
    els.mapPlaceholder.hidden = false;
    $("strong", els.mapPlaceholder).textContent = "El mapa no está disponible";
    $("p", els.mapPlaceholder).textContent = "Puedes crear recordatorios usando tu ubicación actual.";
  }
}

async function waitForLeaflet() {
  if (globalThis.L) return true;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(100);
    if (globalThis.L) return true;
  }
  return false;
}

function startClock() {
  tick();
  window.setInterval(tick, 1000);
}

function tick() {
  processDueReminders();
  refreshStatuses();
  updateGpsUI();
  updateAlarmClock();
}

function processDueReminders() {
  if (ui.activeAlarm) return;
  const now = Date.now();
  for (const reminder of state.reminders) {
    if (!reminder.enabled) continue;
    const due =
      (reminder.phase === "waiting" && reminder.pendingUntil && reminder.pendingUntil <= now) ||
      (reminder.phase === "snoozed" && reminder.snoozedUntil && reminder.snoozedUntil <= now);
    if (!due) continue;
    const dueAt = reminder.phase === "snoozed" ? reminder.snoozedUntil : reminder.pendingUntil;
    if (now - dueAt > 2 * 60 * 60 * 1000) {
      reminder.phase = "idle";
      reminder.pendingUntil = null;
      reminder.snoozedUntil = null;
      saveState(state);
      showToast("Un aviso venció mientras la app estaba cerrada.", { type: "info" });
      continue;
    }
    triggerReminder(reminder);
    break;
  }
}

function findReminder(id) {
  return state.reminders.find((reminder) => reminder.id === id) || null;
}

function getReminderStatus(reminder) {
  const now = Date.now();
  const distance = ui.distances.get(reminder.id);

  if (reminder.phase === "ringing") {
    return { key: "ringing", label: "Sonando ahora", detail: "responde para continuar" };
  }
  if (reminder.phase === "done") {
    return { key: "done", label: "Completado", detail: "actívalo para repetir" };
  }
  if (!reminder.enabled) {
    return { key: "paused", label: "Pausado", detail: "no se disparará" };
  }
  if (reminder.phase === "snoozed" && reminder.snoozedUntil) {
    return {
      key: "snoozed",
      label: "Pospuesto",
      detail: `vuelve en ${formatRemaining(reminder.snoozedUntil - now)}`
    };
  }
  if (reminder.phase === "waiting" && reminder.pendingUntil) {
    return {
      key: "waiting",
      label: reminder.pendingDirection === "exit" ? "Salida detectada" : "Llegada detectada",
      detail: `aviso en ${formatRemaining(reminder.pendingUntil - now)}`
    };
  }
  if (reminder.inside === null) {
    return {
      key: "searching",
      label: state.settings.trackingEnabled ? "Buscando señal" : "Sin ubicación",
      detail: state.lastPosition ? "comprobando zona" : "activa la ubicación"
    };
  }
  if (reminder.inside) {
    return {
      key: "inside",
      label: "Dentro del área",
      detail:
        reminder.trigger === "exit"
          ? "te aviso al salir"
          : distance != null
            ? `a ${formatDistance(distance)}`
            : "en la zona"
    };
  }
  return {
    key: "outside",
    label: reminder.trigger === "exit" ? "Fuera del área" : "Esperando llegada",
    detail:
      distance != null
        ? `a ${formatDistance(distance)}`
        : state.lastPosition
          ? "fuera de la zona"
          : "sin señal"
  };
}

function renderReminders() {
  const filtered = state.reminders.filter((reminder) => {
    if (ui.filter === "active") return reminder.enabled;
    if (ui.filter === "paused") return !reminder.enabled;
    return true;
  });

  els.reminderCount.textContent = String(state.reminders.length);
  els.emptyState.hidden = state.reminders.length > 0;
  els.reminderList.innerHTML = filtered
    .map((reminder, index) => reminderCardMarkup(reminder, index))
    .join("");

  if (state.reminders.length > 0 && filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.innerHTML =
      '<svg class="icon"><use href="#i-radar"/></svg><strong>Nada por aquí</strong><p>No hay recordatorios en este filtro.</p>';
    els.reminderList.append(empty);
  }

  refreshStatuses();
  updateMapReminders();
  updateSelectedCard();
  updateNotificationUI();
}

function reminderCardMarkup(reminder, index) {
  const status = getReminderStatus(reminder);
  const triggerLabel = reminder.trigger === "exit" ? "Al salir" : "Al llegar";
  const delayLabel = reminder.delayMin ? `${reminder.delayMin} min después` : "Al instante";
  const repeatLabel = reminder.repeat ? "Se repite" : "Una vez";
  return `
    <article class="reminder-card is-${status.key}" data-id="${escapeHtml(reminder.id)}" style="--index:${index}" tabindex="0" role="button" aria-label="Editar ${escapeHtml(reminder.title)}">
      <div class="reminder-card__top">
        <span class="place-icon"><svg class="icon"><use href="#i-pin"/></svg></span>
        <div class="card-title-group">
          <h3 class="card-title">${escapeHtml(reminder.title)}</h3>
          <p class="card-place"><svg class="icon"><use href="#i-navigation"/></svg><span>${escapeHtml(reminder.placeName)} · ${formatRadius(reminder.radius)}</span></p>
        </div>
        <button class="card-toggle ${reminder.enabled ? "is-on" : ""}" type="button" data-toggle aria-label="${reminder.enabled ? "Pausar" : "Activar"} recordatorio" aria-pressed="${reminder.enabled}">
          <svg class="icon"><use href="#${reminder.enabled ? "i-bell" : "i-bell-off"}"/></svg>
        </button>
      </div>
      <div class="reminder-card__meta">
        <span class="meta-chip"><svg class="icon"><use href="#i-${reminder.trigger === "exit" ? "arrow-right" : "navigation"}"/></svg>${triggerLabel}</span>
        <span class="meta-chip"><svg class="icon"><use href="#i-clock"/></svg>${delayLabel}</span>
        <span class="meta-chip"><svg class="icon"><use href="#i-repeat"/></svg>${repeatLabel}</span>
      </div>
      <div class="reminder-card__status">
        <span class="status-dot"></span>
        <span data-status-label>${escapeHtml(status.label)}</span>
        <span class="status-detail" data-status-detail>${escapeHtml(status.detail)}</span>
      </div>
      <div class="card-actions">
        <button class="card-edit" type="button" data-edit><svg class="icon"><use href="#i-pencil"/></svg>Editar</button>
        <button class="card-test" type="button" data-test><svg class="icon"><use href="#i-play"/></svg>Probar alarma</button>
      </div>
    </article>
  `;
}

function refreshStatuses() {
  for (const card of $$(".reminder-card", els.reminderList)) {
    const reminder = findReminder(card.dataset.id);
    if (!reminder) continue;
    const status = getReminderStatus(reminder);
    card.classList.remove("is-ringing", "is-done", "is-paused", "is-snoozed", "is-waiting", "is-inside", "is-outside", "is-searching");
    card.classList.add(`is-${status.key}`);
    const label = $("[data-status-label]", card);
    const detail = $("[data-status-detail]", card);
    if (label) label.textContent = status.label;
    if (detail) detail.textContent = status.detail;
  }
}

function updateSelectedCard() {
  for (const card of $$(".reminder-card", els.reminderList)) {
    card.classList.toggle("is-selected", card.dataset.id === ui.selectedId);
  }
}

function updateMapReminders() {
  if (ui.dashboardMap) {
    ui.dashboardMap.updateReminders(state.reminders);
  }
}

function toggleReminder(reminder) {
  if (reminder.enabled) {
    reminder.enabled = false;
    reminder.phase = "idle";
    reminder.pendingUntil = null;
    reminder.snoozedUntil = null;
    if (ui.activeAlarm?.reminder.id === reminder.id) dismissAlarm("test");
    showToast(`“${reminder.title}” pausado.`, { type: "info" });
  } else {
    reminder.enabled = true;
    reminder.phase = "idle";
    reminder.pendingUntil = null;
    reminder.snoozedUntil = null;
    showToast(`“${reminder.title}” activado.`, { type: "success" });
  }
  reminder.updatedAt = Date.now();
  saveState(state);
  renderReminders();
}

function testReminder(reminder) {
  if (ui.activeAlarm) {
    showToast("Ya hay una alarma en pantalla.", { type: "info" });
    return;
  }
  triggerReminder(reminder, { test: true });
}

async function triggerReminder(reminder, { test = false } = {}) {
  if (ui.activeAlarm) return false;
  if (!test && !reminder.enabled) return false;

  ui.activeAlarm = {
    id: reminder.id,
    reminder,
    test,
    startedAt: Date.now()
  };

  if (!test) {
    reminder.phase = "ringing";
    reminder.lastFiredAt = Date.now();
    reminder.updatedAt = Date.now();
    saveState(state);
  }

  els.alarmTitle.textContent = reminder.title;
  els.alarmPlace.textContent = `${reminder.placeName} · ${formatRadius(reminder.radius)}`;
  els.alarmNote.textContent = reminder.note || "";
  els.alarmNote.hidden = !reminder.note;
  els.alarmTime.textContent = "Sonando hace 0:00";
  els.alarmSnooze.hidden = test;
  els.alarmDone.hidden = test;
  els.alarmTestClose.hidden = !test;

  const snoozeValues = Array.from(new Set([state.settings.defaultSnooze, 5, 10, 15, 30]))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
    .sort((a, b) => a - b)
    .slice(0, 4);
  els.snoozeOptions.innerHTML = snoozeValues
    .map(
      (minutes) =>
        `<button class="snooze-chip" type="button" data-snooze="${minutes}">+${minutes} min</button>`
    )
    .join("");

  if (!els.alarmDialog.open) els.alarmDialog.showModal();
  alarm.start({ sound: reminder.sound, vibrate: reminder.vibrate && !test }).catch(() => {});
  showReminderNotification(reminder, { test }).catch(() => {});
  if (test) els.alarmTestClose.focus();
  else els.alarmDone.focus();
  refreshStatuses();
  return true;
}

function dismissAlarm(action, snoozeMinutes = state.settings.defaultSnooze) {
  const active = ui.activeAlarm;
  if (!active) return;
  const reminder = active.reminder;

  alarm.stop();
  closeReminderNotification(reminder.id).catch(() => {});
  if (els.alarmDialog.open) els.alarmDialog.close();
  ui.activeAlarm = null;

  if (active.test) {
    refreshStatuses();
    return;
  }

  if (action === "snooze") {
    reminder.phase = "snoozed";
    reminder.snoozedUntil = Date.now() + Math.max(1, snoozeMinutes) * 60 * 1000;
    reminder.pendingUntil = null;
    reminder.updatedAt = Date.now();
    saveState(state);
    renderReminders();
    showToast(`Pospuesto ${snoozeMinutes} min.`, {
      type: "info",
      icon: "clock",
      duration: 4000
    });
    return;
  }

  if (action === "done") {
    reminder.fireCount = (reminder.fireCount || 0) + 1;
    reminder.updatedAt = Date.now();
    reminder.snoozedUntil = null;
    reminder.pendingUntil = null;
    if (reminder.repeat) {
      reminder.phase = "idle";
      reminder.enabled = true;
      showToast(`Hecho. “${reminder.title}” volverá a avisarte en la próxima visita.`, {
        type: "success",
        duration: 5000
      });
    } else {
      reminder.phase = "done";
      reminder.enabled = false;
      showToast("Recordatorio completado.", { type: "success" });
    }
    saveState(state);
    renderReminders();
    window.setTimeout(processDueReminders, 500);
  }
}

function updateAlarmClock() {
  if (!ui.activeAlarm) return;
  const seconds = Math.max(0, Math.floor((Date.now() - ui.activeAlarm.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  els.alarmTime.textContent = `Sonando hace ${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function handlePosition(position) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
  state.lastPosition = position;
  for (const reminder of state.reminders) {
    ui.distances.set(
      reminder.id,
      distanceMeters(position.lat, position.lng, reminder.lat, reminder.lng)
    );
  }
  if (ui.dashboardMap) {
    ui.dashboardMap.setUser(position);
    els.mapPanel.classList.add("has-map");
  }
  processGeofences(position);
  saveSoon();
  updateGpsUI();
}

function processGeofences(position) {
  let changed = false;
  for (const reminder of state.reminders) {
    const distance = distanceMeters(position.lat, position.lng, reminder.lat, reminder.lng);
    ui.distances.set(reminder.id, distance);

    const enterLimit = reminder.radius + Math.min(20, position.accuracy * 0.2);
    const exitLimit = reminder.radius + Math.max(20, Math.min(90, position.accuracy * 0.6));
    const wasInside = reminder.inside;

    if (wasInside === null) {
      reminder.inside = distance <= enterLimit;
      changed = true;
      continue;
    }

    if (!wasInside && distance <= enterLimit) {
      reminder.inside = true;
      changed = true;
      onEnterArea(reminder);
    } else if (wasInside && distance > exitLimit) {
      reminder.inside = false;
      changed = true;
      onExitArea(reminder);
    }
  }
  if (changed) saveState(state);
}

function onEnterArea(reminder) {
  if (!reminder.enabled || reminder.phase === "ringing" || reminder.phase === "snoozed") return;
  if (reminder.trigger !== "enter") return;
  armReminder(reminder, "enter");
}

function onExitArea(reminder) {
  if (
    reminder.trigger === "enter" &&
    reminder.phase === "waiting" &&
    reminder.pendingDirection === "enter" &&
    reminder.requireStay
  ) {
    reminder.phase = "idle";
    reminder.pendingUntil = null;
    saveState(state);
    showToast("Aviso cancelado: saliste del área antes de tiempo.", { type: "info" });
    return;
  }
  if (!reminder.enabled || reminder.phase === "ringing" || reminder.phase === "snoozed") return;
  if (reminder.trigger !== "exit") return;
  armReminder(reminder, "exit");
}

function armReminder(reminder, direction) {
  const delay = Math.max(0, Number(reminder.delayMin) || 0);
  if (delay > 0 || ui.activeAlarm) {
    reminder.phase = "waiting";
    reminder.pendingDirection = direction;
    reminder.pendingUntil = Date.now() + (delay > 0 ? delay * 60 * 1000 : 1500);
    reminder.updatedAt = Date.now();
    saveState(state);
    return;
  }
  triggerReminder(reminder);
}

function updateGpsUI() {
  const position = state.lastPosition;
  const activeCount = state.reminders.filter((reminder) => reminder.enabled).length;
  const status = ui.trackerStatus;
  const enabled = state.settings.trackingEnabled;

  els.trackingPill.classList.toggle("is-active", enabled);
  els.trackingPill.setAttribute("aria-pressed", String(enabled));
  const compactLabel = window.matchMedia("(max-width: 430px)").matches;
  if (!enabled) {
    els.trackingLabel.textContent = compactLabel ? "Apagada" : "Ubicación apagada";
  } else if (status === "starting") {
    els.trackingLabel.textContent = compactLabel ? "Conectando" : "Conectando…";
  } else if (status === "error") {
    els.trackingLabel.textContent = compactLabel ? "Sin señal" : "Sin señal";
  } else {
    els.trackingLabel.textContent = compactLabel ? "Activa" : "Vigilancia activa";
  }

  els.gpsIndicator.className = "gps-indicator";
  if (!enabled) {
    els.gpsIndicator.classList.add("is-off");
    els.gpsTitle.textContent = "Ubicación apagada";
    els.gpsSubtitle.textContent = "Actívala para empezar";
    els.gpsAction.hidden = false;
    els.gpsAction.textContent = "Activar";
  } else if (status === "starting" || (!position && status !== "error")) {
    els.gpsIndicator.classList.add("is-active");
    els.gpsTitle.textContent = "Conectando con el GPS…";
    els.gpsSubtitle.textContent = "Acepta el permiso si aparece";
    els.gpsAction.hidden = true;
  } else if (status === "error") {
    els.gpsIndicator.classList.add("is-error");
    els.gpsTitle.textContent = "Sin señal de ubicación";
    els.gpsSubtitle.textContent = ui.trackerError || "Comprueba el GPS y vuelve a intentar";
    els.gpsAction.hidden = false;
    els.gpsAction.textContent = "Reintentar";
  } else if (position) {
    els.gpsIndicator.classList.add(status === "weak" ? "is-weak" : "is-active");
    els.gpsTitle.textContent =
      activeCount > 0 ? `Vigilando ${activeCount} ${activeCount === 1 ? "lugar" : "lugares"}` : "Ubicación activa";
    els.gpsSubtitle.textContent = `${formatAccuracy(position.accuracy)} · ${positionAgeLabel(position.timestamp)}`;
    els.gpsAction.hidden = true;
  } else {
    els.gpsIndicator.classList.add("is-off");
    els.gpsTitle.textContent = "Ubicación apagada";
    els.gpsSubtitle.textContent = "Actívala para empezar";
    els.gpsAction.hidden = false;
    els.gpsAction.textContent = "Activar";
  }

  if (position) {
    els.mapPanel.classList.add("has-map");
    els.accuracyLabel.textContent = `GPS ${formatAccuracy(position.accuracy)}`;
  } else {
    els.accuracyLabel.textContent = "";
  }

  const placeholderTitle = $("strong", els.mapPlaceholder);
  const placeholderText = $("p", els.mapPlaceholder);
  if (placeholderTitle && placeholderText) {
    if (enabled && status !== "error") {
      placeholderTitle.textContent = "Buscando tu ubicación…";
      placeholderText.textContent = "En cuanto el GPS responda verás tu posición y tus zonas de aviso.";
    } else if (status === "error") {
      placeholderTitle.textContent = "No encontramos tu ubicación";
      placeholderText.textContent = ui.trackerError || "Revisa los permisos y vuelve a intentarlo.";
    } else {
      placeholderTitle.textContent = "Tu radar está en pausa";
      placeholderText.textContent = "Activa la ubicación para ver dónde estás y tus zonas de aviso.";
    }
  }
}

function handleTrackerStatus({ state: status, position }) {
  ui.trackerStatus = status;
  if (position) {
    state.lastPosition = position;
    if (ui.dashboardMap) ui.dashboardMap.setUser(position);
  }
  if (status === "off" && tracker.active) return;
  updateGpsUI();
  updateSettingsUI();
}

function handleTrackerError(error, code) {
  ui.trackerError = error.message;
  ui.trackerStatus = "error";
  if (code === "denied") {
    state.settings.trackingEnabled = false;
    saveState(state);
    releaseWakeLock();
    showToast("Permiso de ubicación denegado. Actívalo en los ajustes del navegador.", {
      type: "error",
      duration: 7000
    });
  } else if (Date.now() - (ui.lastGeoToastAt || 0) > 15000) {
    ui.lastGeoToastAt = Date.now();
    showToast(error.message, { type: "error" });
  }
  updateGpsUI();
  updateSettingsUI();
}

async function restoreTracking() {
  tracker.lastPosition = state.lastPosition;
  ui.trackerPermission = await tracker.getPermissionState();
  if (state.settings.trackingEnabled && ui.trackerPermission === "granted") {
    tracker.start();
    acquireWakeLock();
  } else if (state.settings.trackingEnabled) {
    state.settings.trackingEnabled = false;
    saveState(state);
  }
  updateGpsUI();
  updateSettingsUI();
}

function toggleTracking() {
  if (state.settings.trackingEnabled) disableTracking();
  else enableTracking({ userInitiated: true });
}

function enableTracking({ userInitiated = false } = {}) {
  if (!tracker.supported) {
    showToast("Este navegador no puede usar tu ubicación.", { type: "error" });
    return;
  }
  state.settings.trackingEnabled = true;
  ui.trackerError = "";
  ui.trackerStatus = "starting";
  saveState(state);
  tracker.start();
  acquireWakeLock();
  navigator.storage?.persist?.().catch(() => {});
  updateGpsUI();
  if (userInitiated) {
    showToast("Buscando tu ubicación. Mantén Llegada abierta para vigilar.", {
      type: "info",
      icon: "locate",
      duration: 5000
    });
  }
}

function disableTracking() {
  tracker.stop();
  state.settings.trackingEnabled = false;
  saveState(state);
  releaseWakeLock();
  updateGpsUI();
  showToast("Vigilancia pausada. Tus recordatorios siguen guardados.", {
    type: "info",
    icon: "pause"
  });
}

async function acquireWakeLock() {
  if (!state.settings.keepAwake || !("wakeLock" in navigator) || document.visibilityState !== "visible") {
    return;
  }
  if (wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function saveSoon() {
  if (ui.saveTimer) return;
  ui.saveTimer = window.setTimeout(() => {
    ui.saveTimer = null;
    saveState(state);
  }, 8000);
}

function openReminderDialog(reminder = null, prefill = {}) {
  ui.editingId = reminder?.id || null;
  ui.selectedId = reminder?.id || null;
  ui.pickerPoint = reminder ? { lat: reminder.lat, lng: reminder.lng } : null;

  const data = reminder || {
    title: prefill.title || "",
    note: "",
    placeName: prefill.placeName || "",
    radius: 150,
    trigger: "enter",
    delayMin: 0,
    requireStay: true,
    repeat: false,
    sound: true,
    vibrate: true
  };

  els.reminderDialogEyebrow.textContent = reminder ? "Editando recordatorio" : "Nuevo recordatorio";
  els.reminderDialogTitle.textContent = reminder ? "Editar recordatorio" : "¿Qué te recuerdo?";
  els.saveReminderLabel.textContent = reminder ? "Guardar cambios" : "Guardar recordatorio";
  els.deleteReminder.hidden = !reminder;
  els.formError.hidden = true;

  els.fieldTitle.value = data.title || "";
  els.fieldNote.value = data.note || "";
  els.fieldPlace.value = data.placeName || "";
  els.fieldRadius.value = String(data.radius || 150);
  els.radiusOutput.value = `${data.radius || 150} m`;
  els.radiusPill.textContent = formatRadius(data.radius || 150);
  els.placeSearch.value = "";
  els.searchResults.hidden = true;
  els.fieldDelay.value = String(data.delayMin || 0);
  setRadio("trigger", data.trigger || "enter");
  els.fieldRepeat.checked = Boolean(data.repeat);
  els.fieldRequireStay.checked = data.requireStay !== false;
  els.fieldSound.checked = data.sound !== false;
  els.fieldVibrate.checked = data.vibrate !== false;
  els.advancedSettings.open = Boolean(
    reminder && (data.repeat || data.requireStay === false || data.sound === false || data.vibrate === false)
  );
  updateDelayUI();
  updateCoordsLine();

  if (!els.reminderDialog.open) els.reminderDialog.showModal();
  els.reminderDialog.querySelector(".sheet-body").scrollTop = 0;
  setupPicker(reminder);
  window.setTimeout(() => {
    ui.picker?.invalidateSize();
    if (!reminder) els.fieldTitle.focus({ preventScroll: true });
  }, 220);
}

function closeReminderDialog() {
  if (els.reminderDialog.open) els.reminderDialog.close();
}

function setupPicker(reminder) {
  const radius = Number(els.fieldRadius.value) || 150;
  const center = ui.pickerPoint || state.lastPosition || DEFAULT_CENTER;

  if (!ui.picker) {
    if (!globalThis.L) return;
    ui.picker = new PickerMap(els.pickerMap, {
      lat: ui.pickerPoint?.lat,
      lng: ui.pickerPoint?.lng,
      radius,
      onChange: ({ lat, lng }) => {
        ui.pickerPoint = { lat, lng };
        updateCoordsLine();
        if (!els.fieldPlace.value.trim()) {
          els.fieldPlace.value = "Mi ubicación";
        }
      }
    });
    if (!ui.pickerPoint) {
      ui.picker.clearPoint();
      ui.picker.centerOn(center.lat, center.lng, state.lastPosition ? 15 : 13);
    }
  } else {
    ui.picker.invalidateSize();
    ui.picker.setRadius(radius);
    if (ui.pickerPoint) {
      ui.picker.reset(ui.pickerPoint.lat, ui.pickerPoint.lng, radius);
    } else {
      ui.picker.clearPoint();
      ui.picker.centerOn(center.lat, center.lng, state.lastPosition ? 15 : 13);
    }
  }

  window.setTimeout(() => {
    ui.picker?.invalidateSize();
    if (ui.pickerPoint) ui.picker.setPoint(ui.pickerPoint.lat, ui.pickerPoint.lng, { fly: true });
  }, 180);
}

function setPickerPoint(lat, lng, { fly = true } = {}) {
  ui.pickerPoint = { lat, lng };
  ui.picker?.setPoint(lat, lng, { fly });
  updateCoordsLine();
}

function updateCoordsLine() {
  if (!ui.pickerPoint) {
    els.coordsLine.textContent = "Sin ubicación elegida aún. Toca el mapa, busca una dirección o usa tu ubicación.";
    return;
  }
  els.coordsLine.textContent = `Coordenadas ${ui.pickerPoint.lat.toFixed(5)}, ${ui.pickerPoint.lng.toFixed(5)} · radio ${formatRadius(Number(els.fieldRadius.value) || 150)}`;
}

function updateDelayUI() {
  const trigger = getRadio("trigger") || "enter";
  const value = clamp(Number(els.fieldDelay.value) || 0, 0, 180);
  els.fieldDelay.value = String(value);
  els.delayReadout.textContent = value === 0 ? "Al instante" : `${value} min después`;
  const isPreset = [0, 2, 5, 10, 15].includes(value);
  els.delayCustomWrap.hidden = isPreset || value === 0;
  els.delayPresets.querySelectorAll(".delay-chip").forEach((chip) => {
    const chipValue = chip.dataset.delay;
    chip.classList.toggle(
      "is-active",
      chipValue !== "custom" && Number(chipValue) === value
    );
  });
  els.requireStayRow.hidden = trigger === "exit" || value === 0;

  if (trigger === "exit") {
    els.delayHelper.textContent =
      value === 0
        ? "Te avisaré en cuanto salgas del radio."
        : `Te avisaré ${value} min después de salir del área.`;
  } else {
    els.delayHelper.textContent =
      value === 0
        ? "El aviso se lanza en cuanto entras en el radio."
        : `Te avisaré ${value} min después de entrar. Si sales antes, puedes cancelar el aviso.`;
  }
}

function setDelayValue(value) {
  els.fieldDelay.value = String(clamp(value, 0, 180));
  updateDelayUI();
}

function getRadio(name) {
  return els.reminderForm.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function setRadio(name, value) {
  const input = els.reminderForm.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

async function handleReminderSubmit(event) {
  event.preventDefault();
  els.formError.hidden = true;

  const title = els.fieldTitle.value.trim();
  if (!title) {
    showFormError("Ponle un nombre a tu recordatorio.");
    els.fieldTitle.focus();
    return;
  }
  if (!ui.pickerPoint) {
    showFormError("Elige un lugar: toca el mapa, busca una dirección o usa tu ubicación actual.");
    els.pickerMap.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const radius = clamp(Number(els.fieldRadius.value) || 150, 30, 1000);
  const delayMin = clamp(Number(els.fieldDelay.value) || 0, 0, 180);
  const placeName = els.fieldPlace.value.trim() || "Lugar";
  const trigger = getRadio("trigger") || "enter";
  const now = Date.now();
  const payload = {
    title,
    note: els.fieldNote.value.trim(),
    placeName,
    lat: ui.pickerPoint.lat,
    lng: ui.pickerPoint.lng,
    radius,
    trigger,
    delayMin,
    requireStay: els.fieldRequireStay.checked,
    repeat: els.fieldRepeat.checked,
    sound: els.fieldSound.checked,
    vibrate: els.fieldVibrate.checked,
    updatedAt: now
  };

  if (ui.editingId) {
    const existing = findReminder(ui.editingId);
    if (!existing) {
      showFormError("Este recordatorio ya no existe.");
      return;
    }
    const locationChanged =
      Math.abs(existing.lat - payload.lat) > 0.00001 ||
      Math.abs(existing.lng - payload.lng) > 0.00001 ||
      existing.radius !== payload.radius;
    const ruleChanged =
      existing.trigger !== payload.trigger ||
      existing.delayMin !== payload.delayMin;

    Object.assign(existing, payload);
    if (locationChanged || ruleChanged) {
      existing.inside = null;
      existing.phase = "idle";
      existing.pendingUntil = null;
      existing.snoozedUntil = null;
      ui.distances.delete(existing.id);
    }
  } else {
    const reminder = createReminder(payload);
    if (state.lastPosition) {
      const distance = distanceMeters(
        state.lastPosition.lat,
        state.lastPosition.lng,
        reminder.lat,
        reminder.lng
      );
      reminder.inside = distance <= reminder.radius;
      ui.distances.set(reminder.id, distance);
    }
    state.reminders.unshift(reminder);
    ui.selectedId = reminder.id;
  }

  if (!saveState(state)) {
    showFormError("No se pudo guardar. Revisa el espacio disponible del navegador.");
    return;
  }

  closeReminderDialog();
  renderReminders();
  updateNotificationUI();
  const active = state.settings.trackingEnabled;
  showToast(
    active
      ? `Guardado. Te avisaré ${trigger === "exit" ? "al salir" : "al llegar"}.`
      : "Guardado. Activa la vigilancia de ubicación para que suene.",
    { type: "success", duration: 4500 }
  );
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

function deleteCurrentReminder() {
  if (!ui.editingId) return;
  const reminder = findReminder(ui.editingId);
  if (!reminder) return;
  if (!window.confirm(`¿Eliminar “${reminder.title}”? Esta acción no se puede deshacer.`)) return;
  state.reminders = state.reminders.filter((item) => item.id !== reminder.id);
  if (ui.activeAlarm?.reminder.id === reminder.id) dismissAlarm("test");
  saveState(state);
  closeReminderDialog();
  renderReminders();
  showToast("Recordatorio eliminado.", { type: "info" });
}

async function useCurrentLocationInForm() {
  els.useCurrentLocation.disabled = true;
  const original = els.useCurrentLocation.innerHTML;
  els.useCurrentLocation.innerHTML = '<svg class="icon"><use href="#i-locate"/></svg>Ubicando…';
  try {
    let position = state.lastPosition;
    if (!position || Date.now() - position.timestamp > 60000) {
      position = await tracker.locateOnce();
      state.lastPosition = position;
      if (ui.dashboardMap) {
        ui.dashboardMap.setUser(position, { center: true });
        els.mapPanel.classList.add("has-map");
      }
    }
    setPickerPoint(position.lat, position.lng, { fly: true });
    if (!els.fieldPlace.value.trim()) {
      els.fieldPlace.value = "Mi ubicación";
      reverseGeocode(position.lat, position.lng);
    }
    updateCoordsLine();
  } catch (error) {
    showToast(error.message, { type: "error" });
  } finally {
    els.useCurrentLocation.disabled = false;
    els.useCurrentLocation.innerHTML = original;
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("accept-language", "es");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    const name = data.name || data.display_name?.split(",")[0] || "";
    if (name && !els.fieldPlace.value.trim()) els.fieldPlace.value = name.slice(0, 60);
  } catch {
    // Optional nice-to-have.
  }
}

async function searchPlaces() {
  const query = els.placeSearch.value.trim();
  if (query.length < 3) {
    showSearchMessage("Escribe al menos 3 caracteres.");
    return;
  }
  els.placeSearchButton.disabled = true;
  els.placeSearchButton.textContent = "Buscando…";
  showSearchMessage("Buscando direcciones…");
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "es");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("El buscador no respondió.");
    const results = await response.json();
    renderSearchResults(results);
  } catch (error) {
    showSearchMessage("No se pudo buscar. Revisa tu conexión e inténtalo otra vez.");
    console.warn(error);
  } finally {
    els.placeSearchButton.disabled = false;
    els.placeSearchButton.textContent = "Buscar";
  }
}

function renderSearchResults(results) {
  els.searchResults.innerHTML = "";
  if (!Array.isArray(results) || results.length === 0) {
    showSearchMessage("No encontré ese lugar. Prueba con otra dirección o toca el mapa.");
    return;
  }
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.setAttribute("role", "option");
    button.dataset.lat = result.lat;
    button.dataset.lon = result.lon;
    button.dataset.name = result.name || result.display_name?.split(",")[0] || "Lugar";
    button.dataset.label = result.display_name || result.name || "Lugar";
    const strong = document.createElement("strong");
    strong.textContent = result.name || result.display_name?.split(",")[0] || "Lugar";
    const span = document.createElement("span");
    span.textContent = result.display_name || "";
    button.append(strong, span);
    els.searchResults.append(button);
  }
  els.searchResults.hidden = false;
}

function showSearchMessage(message) {
  els.searchResults.innerHTML = "";
  const div = document.createElement("div");
  div.className = "search-message";
  div.textContent = message;
  els.searchResults.append(div);
  els.searchResults.hidden = false;
}

function selectSearchResult(button) {
  const lat = Number(button.dataset.lat);
  const lng = Number(button.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  setPickerPoint(lat, lng, { fly: true });
  if (!els.fieldPlace.value.trim()) {
    els.fieldPlace.value = (button.dataset.name || "Lugar").slice(0, 60);
  }
  els.placeSearch.value = button.dataset.label || button.dataset.name || "";
  els.searchResults.hidden = true;
}

function openSettings() {
  updateSettingsUI();
  if (ui.updateInfo) {
    els.updateStatus.textContent = `Nueva versión v${ui.updateInfo.version} disponible para instalar.`;
    els.updateStatus.classList.add("is-available");
  }
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
  els.settingsDialog.querySelector(".sheet-body").scrollTop = 0;
}

function updateSettingsUI() {
  if (!els.settingSnooze) return;
  ensureSnoozeOption(state.settings.defaultSnooze);
  els.settingSnooze.value = String(state.settings.defaultSnooze);
  els.settingWakeLock.checked = Boolean(state.settings.keepAwake);
  els.settingAutoUpdate.checked = Boolean(state.settings.autoUpdateCheck);

  const permission = notificationPermission();
  els.geolocationStatus.textContent =
    state.settings.trackingEnabled && tracker.active
      ? "Ubicación: activa"
      : ui.trackerPermission === "denied"
        ? "Ubicación: denegada"
        : "Ubicación: apagada";
  els.geolocationStatus.classList.toggle(
    "is-ok",
    state.settings.trackingEnabled && tracker.active && ui.trackerPermission !== "denied"
  );
  els.geolocationStatus.classList.toggle("is-bad", ui.trackerPermission === "denied");

  const notificationsText =
    permission === "granted"
      ? "Notificaciones: activas"
      : permission === "denied"
        ? "Notificaciones: bloqueadas"
        : permission === "unsupported"
          ? "Notificaciones: no disponibles"
          : "Notificaciones: sin permiso";
  els.notificationsStatus.textContent = notificationsText;
  els.notificationsStatus.classList.toggle("is-ok", permission === "granted");
  els.notificationsStatus.classList.toggle("is-bad", permission === "denied" || permission === "unsupported");

  els.settingsNotifications.querySelector("span").textContent =
    permission === "granted" ? "Notificaciones activadas" : "Activar notificaciones";
  els.settingsNotifications.disabled = permission === "granted" || permission === "unsupported";

  els.installButton.hidden = isStandalone() || (!ui.deferredInstall && !isIos());
}

function ensureSnoozeOption(minutes) {
  const value = String(minutes);
  if (!$(`option[value="${value}"]`, els.settingSnooze)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${minutes} min`;
    els.settingSnooze.append(option);
  }
}

function updateNotificationUI() {
  const permission = notificationPermission();
  if (!els.notificationDot) return;
  const relevant = state.reminders.length > 0 || state.settings.trackingEnabled;
  els.notificationDot.hidden =
    permission === "granted" || !relevant || state.settings.notificationsDismissed;
  const showBanner =
    permission === "default" &&
    !state.settings.notificationsDismissed &&
    relevant;
  els.permissionBanner.hidden = !showBanner;
}

async function requestNotifications() {
  try {
    const result = await requestNotificationPermission();
    updateNotificationUI();
    updateSettingsUI();
    if (result === "granted") {
      showToast("Notificaciones activadas.", { type: "success" });
    } else {
      showToast("No se activaron las notificaciones.", { type: "info" });
    }
  } catch (error) {
    showToast(error.message, { type: "error", duration: 6500 });
  }
}

function installApp() {
  if (ui.deferredInstall) {
    const prompt = ui.deferredInstall;
    ui.deferredInstall = null;
    prompt.prompt();
    prompt.userChoice.finally(() => {
      els.installButton.hidden = true;
      updateSettingsUI();
    });
    return;
  }
  if (isIos()) {
    showToast("En Safari: toca Compartir y luego “Añadir a pantalla de inicio”.", {
      type: "info",
      duration: 9000
    });
    return;
  }
  showToast("Abre el menú del navegador y elige “Instalar aplicación”.", {
    type: "info",
    duration: 6000
  });
}

function exportData() {
  const data = exportState(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `llegada-copia-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Copia exportada.", { type: "success" });
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const document = JSON.parse(text);
    const imported = serializeImport(document);
    if (!window.confirm(`Se reemplazarán tus ${state.reminders.length} recordatorios por ${imported.reminders.length}. ¿Continuar?`)) {
      return;
    }
    state.reminders = imported.reminders;
    state.settings.defaultSnooze = clamp(Number(imported.settings.defaultSnooze) || 10, 1, 120);
    state.settings.keepAwake = imported.settings.keepAwake !== false;
    state.settings.autoUpdateCheck = imported.settings.autoUpdateCheck !== false;
    saveState(state);
    renderReminders();
    updateSettingsUI();
    showToast("Copia importada.", { type: "success" });
  } catch (error) {
    showToast(error.message || "No se pudo importar la copia.", { type: "error", duration: 6500 });
  }
}

function clearAllData() {
  if (!state.reminders.length) {
    showToast("No hay recordatorios para borrar.", { type: "info" });
    return;
  }
  if (!window.confirm(`¿Borrar los ${state.reminders.length} recordatorios? Tus ajustes se conservan.`)) return;
  state.reminders = [];
  if (ui.activeAlarm) dismissAlarm("test");
  saveState(state);
  renderReminders();
  showToast("Recordatorios borrados.", { type: "info" });
}

function showInfoDialog() {
  if (!els.infoDialog.open) els.infoDialog.showModal();
  els.infoDialog.querySelector(".sheet-body").scrollTop = 0;
}

async function checkForUpdates({ manual = false } = {}) {
  if (updater.checking) return;
  const original = els.checkUpdates.innerHTML;
  els.checkUpdates.disabled = true;
  els.checkUpdates.innerHTML = '<svg class="icon"><use href="#i-refresh"/></svg><span>Buscando…</span>';
  els.updateStatus.classList.remove("is-available", "is-error");
  els.updateStatus.textContent = "Consultando GitHub…";
  try {
    const result = await updater.check({ manual });
    state.settings.lastUpdateCheckAt = Date.now();
    saveState(state);
    ui.updateInfo = result;
    if (result.available) {
      els.updateDot.hidden = false;
      els.showUpdate.hidden = false;
      els.downloadPackage.hidden = !result.packageUrl;
      els.updateStatus.classList.add("is-available");
      els.updateStatus.textContent = `Nueva versión v${result.version} disponible. Tienes la v${BUILD.version}.`;
      if (manual) openUpdateDialog();
      else {
        showToast(`Hay una nueva versión de Llegada: v${result.version}.`, {
          type: "info",
          icon: "download",
          duration: 7000
        });
      }
    } else {
      els.updateDot.hidden = true;
      els.showUpdate.hidden = true;
      els.downloadPackage.hidden = true;
      els.updateStatus.textContent = `Estás al día · v${BUILD.version}`;
      if (manual) showToast("Llegada está al día.", { type: "success" });
    }
  } catch (error) {
    els.updateStatus.classList.add("is-error");
    els.updateStatus.textContent = error.message || "No se pudo comprobar la actualización.";
    if (manual) showToast(error.message || "No se pudo comprobar la actualización.", { type: "error" });
  } finally {
    els.checkUpdates.disabled = false;
    els.checkUpdates.innerHTML = original;
  }
}

function openUpdateDialog() {
  const update = ui.updateInfo;
  if (!update) {
    checkForUpdates({ manual: true });
    return;
  }
  els.updateFromVersion.textContent = BUILD.version;
  els.updateToVersion.textContent = update.version;
  els.updateSize.textContent = update.size ? formatBytes(update.size) : "Paquete completo";
  els.updateDate.textContent = update.releasedAt ? `Publicada ${formatDate(update.releasedAt)}` : "Publicada en GitHub";
  els.updateNotesList.innerHTML = update.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  els.updateNotesEmpty.hidden = update.notes.length > 0;
  els.updateError.hidden = true;
  els.installProgress.hidden = true;
  els.installUpdate.disabled = false;
  els.installUpdate.innerHTML = '<svg class="icon"><use href="#i-download"/></svg><span>Descargar e instalar</span>';
  els.releaseLink.href = update.releaseUrl || BUILD.releaseUrl;
  els.downloadPackageDialog.hidden = !update.packageUrl;
  if (!els.updateDialog.open) els.updateDialog.showModal();
  els.updateDialog.querySelector(".sheet-body").scrollTop = 0;
}

async function installUpdate() {
  const update = ui.updateInfo;
  if (!update) return;
  els.updateError.hidden = true;
  els.installUpdate.disabled = true;
  els.installUpdate.innerHTML = '<svg class="icon"><use href="#i-refresh"/></svg><span>Instalando…</span>';
  els.installProgress.hidden = false;
  updateInstallProgress({ percent: 0, label: "Preparando instalación…", detail: "Conectando con GitHub…" });

  try {
    await updater.install(update, (progress) => updateInstallProgress(progress));
  } catch (error) {
    console.error(error);
    els.updateError.hidden = false;
    els.updateError.textContent = error.message || "No se pudo instalar la actualización.";
    els.installUpdate.disabled = false;
    els.installUpdate.innerHTML = '<svg class="icon"><use href="#i-download"/></svg><span>Reintentar instalación</span>';
    showToast(error.message || "No se pudo instalar la actualización.", { type: "error", duration: 7000 });
  }
}

function updateInstallProgress({ percent = 0, label = "", detail = "" }) {
  const value = clamp(Math.round(percent), 0, 100);
  els.installProgressLabel.textContent = label || "Instalando…";
  els.installProgressPercent.textContent = `${value}%`;
  els.installProgressBar.style.width = `${value}%`;
  els.installProgressDetail.textContent = detail || "";
}

function downloadPackage(update) {
  if (!update) {
    showToast("Primero busca una actualización.", { type: "info" });
    return;
  }
  if (!updater.downloadPackage(update)) {
    showToast("El paquete todavía no está disponible. Prueba en unos minutos.", { type: "info" });
    return;
  }
  showToast("Descargando el paquete .zip desde GitHub.", { type: "info", icon: "download" });
}

function maybeAutoUpdateCheck({ force = false } = {}) {
  if (!state.settings.autoUpdateCheck || !navigator.onLine) return;
  const last = Number(state.settings.lastUpdateCheckAt) || 0;
  if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return;
  window.setTimeout(() => checkForUpdates({ manual: false }), force ? 600 : 3500);
}

function handleQueryParams() {
  const url = new URL(window.location.href);
  const alarmId = url.searchParams.get("alarm");
  const openNew = url.searchParams.get("new");
  if (alarmId) {
    window.setTimeout(() => {
      const reminder = findReminder(alarmId);
      if (reminder && !ui.activeAlarm) triggerReminder(reminder);
    }, 600);
  } else if (openNew === "1") {
    window.setTimeout(() => openReminderDialog(), 250);
  }
  if (alarmId || openNew) {
    url.searchParams.delete("alarm");
    url.searchParams.delete("new");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function restoreRecoveredAlarms() {
  if (!ui.recoveredRinging.length) return;
  const first = findReminder(ui.recoveredRinging[0]);
  if (first && first.enabled) {
    window.setTimeout(() => {
      if (!ui.activeAlarm) triggerReminder(first);
    }, 800);
  }
  for (const id of ui.recoveredRinging.slice(1)) {
    const reminder = findReminder(id);
    if (reminder) reminder.phase = "idle";
  }
  if (ui.recoveredRinging.length > 1) saveState(state);
}

function handleNotificationClick(reminderId) {
  if (!reminderId) return;
  const reminder = findReminder(reminderId);
  if (!reminder) return;
  if (ui.activeAlarm?.id === reminderId) {
    els.alarmDone.focus();
    return;
  }
  triggerReminder(reminder);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), {
      scope: "./",
      updateViaCache: "none"
    });
    window.setTimeout(() => registration.update().catch(() => {}), 5000);
  } catch (error) {
    console.warn("Service worker no disponible", error);
  }
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function showToast(message, { type = "info", icon = "info", duration = 4200 } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast--error" : ""}`;
  const iconName = type === "success" ? "check" : type === "error" ? "alert" : icon;
  toast.innerHTML = `<svg class="icon"><use href="#i-${iconName}"/></svg><span></span>`;
  toast.querySelector("span").textContent = message;
  els.toastStack.append(toast);
  while (els.toastStack.children.length > 3) {
    els.toastStack.firstElementChild.remove();
  }
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, duration);
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRadius(radius) {
  return radius >= 1000 ? `${(radius / 1000).toFixed(1)} km` : `${radius} m`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
