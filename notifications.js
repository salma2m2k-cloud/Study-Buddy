/* =========================================================
   STUDY BUDDY — NOTIFICATIONS
   ---------------------------------------------------------
   BROWSER LIMITATIONS (please read):
   - Real OS notifications require the user to grant permission
     (Notification.requestPermission). We never fake this.
   - We schedule reminders with setTimeout while the tab/app is
     open, AND register them with the Service Worker so they can
     still fire if the tab is in the background — but browsers
     WILL NOT wake up a fully closed browser or a killed mobile
     app. That is a real platform limitation, not a bug here.
   - If the app is installed as a PWA and left running in the
     background (desktop, or Android in many cases), scheduled
     reminders will still show. iOS Safari's support for
     background web push is limited/version-dependent.
   ========================================================= */

const Notifications = (() => {
  let scheduledTimers = new Map(); // id -> timeout handle

  async function permissionState() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }

  async function requestPermission() {
    if (!("Notification" in window)) return "unsupported";
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (e) {
      return "denied";
    }
  }

  async function fireNative(title, body, tag) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, {
        body,
        tag,
        icon: "assets/icons/icon-192.png",
        badge: "assets/icons/icon-192.png",
      });
    } else {
      new Notification(title, { body, icon: "assets/icons/icon-192.png" });
    }
  }

  async function pushToCenter(title, body, kind = "info") {
    const item = {
      id: DB.uid(),
      title,
      body,
      kind, // class | task | achievement | ai | system
      createdAt: Date.now(),
      read: false,
    };
    await DB.put("notifications", item);
    document.dispatchEvent(new CustomEvent("sb:notification", { detail: item }));
    return item;
  }

  async function notify(title, body, { kind = "info", native = true, tag } = {}) {
    await pushToCenter(title, body, kind);
    const enabled = await DB.getSetting("notif_enabled_" + kind, true);
    if (native && enabled) fireNative(title, body, tag);
  }

  /* Schedule a one-off reminder some ms from now, tied to an id so
     it can be cancelled/rescheduled if the source item changes. */
  function scheduleAt(id, whenMs, fn) {
    cancel(id);
    const delayMs = whenMs - Date.now();
    if (delayMs <= 0) return;
    // setTimeout is capped practically ~24 days; class/task reminders
    // are always well within that.
    const handle = setTimeout(() => {
      scheduledTimers.delete(id);
      fn();
    }, delayMs);
    scheduledTimers.set(id, handle);
  }

  function cancel(id) {
    if (scheduledTimers.has(id)) {
      clearTimeout(scheduledTimers.get(id));
      scheduledTimers.delete(id);
    }
  }

  async function markRead(id) {
    const item = await DB.getOne("notifications", id);
    if (item) {
      item.read = true;
      await DB.put("notifications", item);
    }
  }

  async function markAllRead() {
    const all = await DB.getAll("notifications");
    for (const n of all) {
      if (!n.read) {
        n.read = true;
        await DB.put("notifications", n);
      }
    }
  }

  async function unreadCount() {
    const all = await DB.getAll("notifications");
    return all.filter((n) => !n.read).length;
  }

  return {
    permissionState,
    requestPermission,
    notify,
    scheduleAt,
    cancel,
    markRead,
    markAllRead,
    unreadCount,
  };
})();

window.Notifications = Notifications;
