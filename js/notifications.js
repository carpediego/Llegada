const ICON_URL = new URL("./assets/icons/icon-192.png", document.baseURI).href;
const BADGE_URL = new URL("./assets/icons/favicon-32.png", document.baseURI).href;

export function notificationSupported() {
  return "Notification" in window;
}

export function notificationPermission() {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!notificationSupported()) {
    throw new Error("Este navegador no admite notificaciones web.");
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") {
    throw new Error("Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.");
  }
  const result = await Notification.requestPermission();
  return result;
}

export async function showReminderNotification(reminder, { test = false } = {}) {
  if (notificationPermission() !== "granted") return false;
  const title = test ? `Prueba: ${reminder.title}` : reminder.title;
  const body = [
    test ? "Así sonará tu aviso." : `${reminder.placeName} · ${formatTrigger(reminder)}`,
    reminder.note
  ]
    .filter(Boolean)
    .join(" · ");

  const options = {
    body,
    icon: ICON_URL,
    badge: BADGE_URL,
    tag: `llegada-${reminder.id}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { reminderId: reminder.id, test },
    vibrate: reminder.vibrate ? [320, 140, 320, 140, 640] : undefined
  };

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return true;
    }
  } catch (error) {
    console.warn("No se pudo usar el service worker para la notificación", error);
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch (error) {
    console.warn("No se pudo mostrar la notificación", error);
    return false;
  }
}

export async function closeReminderNotification(reminderId) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration?.getNotifications) return;
    const notifications = await registration.getNotifications({ tag: `llegada-${reminderId}` });
    notifications.forEach((notification) => notification.close());
  } catch {
    // Notifications may be unavailable.
  }
}

export function formatTrigger(reminder) {
  const base = reminder.trigger === "exit" ? "Al salir" : "Al llegar";
  if (!reminder.delayMin) return base;
  return `${base} · ${reminder.delayMin} min después`;
}
