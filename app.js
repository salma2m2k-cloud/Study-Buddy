/* =========================================================
   STUDY BUDDY — MAIN APP
   ========================================================= */

const App = (() => {
  let state = {
    section: "home",
    settings: {},
    timer: { mode: "stopwatch", running: false, startedAt: null, elapsed: 0, targetMs: 0, subject: "" },
    activeConversationId: null,
    notesFilter: { search: "", category: "all" },
    tasksFilter: "all",
  };
  let timerInterval = null;
  let countdownWarnedEnd = false;

  /* ---------------- Utilities ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function fmtTime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function fmtDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg, kind = "info") {
    const container = $("#toastContainer");
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  /* ---------------- Boot ---------------- */

  async function init() {
    await loadSettings();
    applyTheme();
    bindNav();
    bindGlobalUI();
    await renderAll();
    scheduleAllClassReminders();
    scheduleAllTaskReminders();
    setInterval(tickHomeCountdown, 1000);
    setInterval(refreshHomeAiMessage, 60000);
    document.addEventListener("sb:notification", renderNotificationBell);
    renderNotificationBell();
  }

  async function loadSettings() {
    const defaults = {
      name: "Student",
      grade: "",
      curriculum: "Egyptian Secondary School",
      term: "Term 1",
      subjects: [],
      lesson: "",
      theme: "system",
      aiPersonality: "friendly",
      aiBackendUrl: "",
      classReminderMinutes: 15,
      notif_enabled_class: true,
      notif_enabled_task: true,
      notif_enabled_study: true,
      notif_enabled_achievement: true,
    };
    const stored = await DB.getSetting("app", {});
    state.settings = Object.assign({}, defaults, stored);
  }

  async function saveSettings() {
    await DB.setSetting("app", state.settings);
  }

  function applyTheme() {
    const theme = state.settings.theme || "system";
    let effective = theme;
    if (theme === "system") {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
  }

  /* ---------------- Navigation ---------------- */

  function bindNav() {
    $$(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        goTo(link.dataset.section);
      });
    });
    $$(".bottom-nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        goTo(link.dataset.section);
      });
    });
    $("#sidebarToggle")?.addEventListener("click", () => {
      $(".sidebar").classList.toggle("collapsed");
    });
  }

  async function goTo(section) {
    state.section = section;
    $$(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.section === section));
    $$(".bottom-nav-link").forEach((l) => l.classList.toggle("active", l.dataset.section === section));
    $$(".app-section").forEach((s) => s.classList.toggle("active", s.id === "section-" + section));
    const renderers = {
      home: renderHome,
      ai: renderAI,
      plans: renderPlans,
      notes: renderNotes,
      session: renderSession,
      extras: renderExtras,
      progress: renderProgress,
      settings: renderSettings,
    };
    await renderers[section]?.();
    $(".main-content")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function renderAll() {
    await goTo(state.section);
  }

  function bindGlobalUI() {
    $("#notifBell")?.addEventListener("click", toggleNotifCenter);
    $("#notifCenterMarkAll")?.addEventListener("click", async () => {
      await Notifications.markAllRead();
      renderNotifCenter();
      renderNotificationBell();
    });
    document.addEventListener("click", (e) => {
      const center = $("#notifCenter");
      if (center && !center.contains(e.target) && !e.target.closest("#notifBell")) {
        center.classList.remove("open");
      }
    });
  }

  async function toggleNotifCenter() {
    const center = $("#notifCenter");
    center.classList.toggle("open");
    if (center.classList.contains("open")) {
      await renderNotifCenter();
      await Notifications.markAllRead();
      renderNotificationBell();
    }
  }

  async function renderNotificationBell() {
    const count = await Notifications.unreadCount();
    const badge = $("#notifBadge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? "9+" : count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  async function renderNotifCenter() {
    const list = await DB.getAll("notifications");
    list.sort((a, b) => b.createdAt - a.createdAt);
    const root = $("#notifCenterList");
    if (!list.length) {
      root.innerHTML = `<div class="empty-state small"><span>🔔</span><p>No notifications yet.</p></div>`;
      return;
    }
    const icons = { class: "📚", task: "✅", achievement: "🏆", ai: "🤖", system: "🔧", info: "🔔" };
    root.innerHTML = list
      .slice(0, 30)
      .map(
        (n) => `
      <div class="notif-item ${n.read ? "" : "unread"}">
        <span class="notif-icon">${icons[n.kind] || "🔔"}</span>
        <div class="notif-body">
          <strong>${escapeHtml(n.title)}</strong>
          <p>${escapeHtml(n.body)}</p>
          <time>${new Date(n.createdAt).toLocaleString()}</time>
        </div>
      </div>`
      )
      .join("");
  }

  /* =========================================================
     HOME
     ========================================================= */

  async function renderHome() {
    const settings = state.settings;
    $("#homeGreetingName").textContent = settings.name || "there";
    updateGreetingIcon();

    const [tasks, classes, sessions] = await Promise.all([
      DB.getAll("tasks"),
      DB.getAll("classes"),
      DB.getAll("sessions"),
    ]);

    const today = todayISO();
    const todaysTasks = tasks.filter((t) => t.dueDate === today);
    const completedToday = todaysTasks.filter((t) => t.completed).length;
    const todaysClasses = getClassOccurrencesForDate(classes, new Date());
    const todaysSessions = sessions.filter((s) => s.date === today);
    const studySecondsToday = todaysSessions.reduce((sum, s) => sum + s.durationMs, 0);

    const streak = computeStreak(sessions);

    $("#statClasses").textContent = todaysClasses.length;
    $("#statTasks").textContent = `${completedToday}/${todaysTasks.length}`;
    $("#statStudyTime").textContent = fmtDuration(studySecondsToday);
    $("#statStreak").textContent = `${streak} day${streak === 1 ? "" : "s"}`;

    renderNextClassCard(todaysClasses, classes);
    renderTodayTaskList(todaysTasks);
    await refreshHomeAiMessage();
  }

  function updateGreetingIcon() {
    const hour = new Date().getHours();
    let text = "Good evening", icon = "🌙";
    if (hour < 12) { text = "Good morning"; icon = "☀️"; }
    else if (hour < 18) { text = "Good afternoon"; icon = "🌤️"; }
    $("#homeGreetingWord").textContent = text;
    $("#homeGreetingIcon").textContent = icon;
  }

  let nextClassCache = null;

  function renderNextClassCard(todaysClasses, allClasses) {
    const upcoming = getNextUpcomingClass(allClasses);
    const card = $("#nextClassCard");
    if (!upcoming) {
      card.innerHTML = `<div class="empty-state small"><span>📅</span><p>No classes planned yet.</p></div>`;
      nextClassCache = null;
      return;
    }
    nextClassCache = upcoming;
    card.innerHTML = `
      <div class="next-class-top">
        <span class="chip" style="background:${upcoming.cls.color || "var(--electric-blue)"}22;color:${upcoming.cls.color || "var(--electric-blue)"}">${escapeHtml(upcoming.cls.subject || upcoming.cls.name)}</span>
        <span class="next-class-time">${upcoming.when.toLocaleDateString(undefined, { weekday: "short" })} · ${upcoming.cls.startTime}</span>
      </div>
      <h3>${escapeHtml(upcoming.cls.name)}</h3>
      <p class="muted">${escapeHtml(upcoming.cls.teacher || "")}</p>
      <div class="countdown" id="nextClassCountdown">--:--:--</div>
      <button class="btn btn-secondary btn-sm" data-goto="plans">View Plan</button>
    `;
    $("[data-goto]", card)?.addEventListener("click", (e) => goTo(e.target.dataset.goto));
  }

  function tickHomeCountdown() {
    if (state.section !== "home" || !nextClassCache) return;
    const el = $("#nextClassCountdown");
    if (!el) return;
    const diff = nextClassCache.when.getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = "Starting now!";
      return;
    }
    el.textContent = "Starts in " + fmtTime(diff);
  }

  async function renderTodayTaskList(todaysTasks) {
    const root = $("#homeTaskList");
    if (!todaysTasks.length) {
      root.innerHTML = `<div class="empty-state small"><span>🎉</span><p>You're all clear for today!</p></div>`;
      return;
    }
    todaysTasks.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
    root.innerHTML = todaysTasks
      .slice(0, 5)
      .map(
        (t) => `
      <label class="mini-task ${t.completed ? "done" : ""}">
        <input type="checkbox" data-task-toggle="${t.id}" ${t.completed ? "checked" : ""}/>
        <span>${escapeHtml(t.title)}</span>
        <span class="priority-dot priority-${t.priority}"></span>
      </label>`
      )
      .join("");
    $$("[data-task-toggle]", root).forEach((el) =>
      el.addEventListener("change", async (e) => {
        await toggleTaskComplete(e.target.dataset.taskToggle);
        renderHome();
      })
    );
  }

  async function refreshHomeAiMessage() {
    if (state.section !== "home") return;
    const [tasks, classes] = await Promise.all([DB.getAll("tasks"), DB.getAll("classes")]);
    const today = todayISO();
    const tasksLeft = tasks.filter((t) => t.dueDate === today && !t.completed).length;
    const upcoming = getNextUpcomingClass(classes);
    const minutesUntilNextClass = upcoming
      ? Math.round((upcoming.when.getTime() - Date.now()) / 60000)
      : null;
    const sessions = await DB.getAll("sessions");
    const msg = AI.homeMessage({
      tasksLeft,
      minutesUntilNextClass,
      nextClassSubject: upcoming?.cls.subject,
      streak: computeStreak(sessions),
    });
    const el = $("#homeAiMessage");
    if (el) el.textContent = msg;
  }

  /* =========================================================
     CLASSES — recurrence helpers (shared by Home + Plans)
     ========================================================= */

  function getNextUpcomingClass(classes) {
    let best = null;
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    for (const cls of classes) {
      const occ = nextOccurrenceOf(cls, now, horizon);
      if (occ && (!best || occ < best.when)) best = { cls, when: occ };
    }
    return best;
  }

  function getClassOccurrencesForDate(classes, dateObj) {
    const dayStart = new Date(dateObj);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const results = [];
    for (const cls of classes) {
      const occ = nextOccurrenceOf(cls, dayStart, dayEnd, true);
      if (occ) results.push({ cls, when: occ });
    }
    return results;
  }

  // Returns the next Date this class occurs at/after `from`, up to `until`.
  // If `inclusiveDay` true, treats `from` as the start of the day being checked.
  function nextOccurrenceOf(cls, from, until, inclusiveDay = false) {
    const [sh, sm] = (cls.startTime || "00:00").split(":").map(Number);
    const anchor = cls.date ? new Date(cls.date + "T00:00:00") : null;

    function atTime(d) {
      const r = new Date(d);
      r.setHours(sh, sm, 0, 0);
      return r;
    }

    if (cls.repeat === "none" || !cls.repeat) {
      if (!anchor) return null;
      const occ = atTime(anchor);
      if (inclusiveDay) {
        return occ >= from && occ < until ? occ : null;
      }
      return occ >= from ? occ : null;
    }

    if (cls.repeat === "daily") {
      for (let i = 0; i < 15; i++) {
        const d = atTime(new Date(from.getTime() + i * 24 * 3600 * 1000));
        if (d >= from && d < until) return d;
        if (!inclusiveDay && d >= from) return d;
      }
      return null;
    }

    if (cls.repeat === "weekly" || cls.repeat === "biweekly" || cls.repeat === "custom") {
      const targetDow = cls.dayOfWeek != null ? cls.dayOfWeek : (anchor ? anchor.getDay() : 0);
      const stepDays = cls.repeat === "biweekly" ? 14 : 7;
      let cursor = new Date(from);
      cursor.setHours(0, 0, 0, 0);
      for (let i = 0; i < stepDays * 3; i++) {
        if (cursor.getDay() === targetDow) {
          if (cls.repeat === "biweekly" && anchor) {
            const diffDays = Math.round((cursor - new Date(anchor).setHours(0, 0, 0, 0)) / 86400000);
            if (((diffDays % 14) + 14) % 14 !== 0) {
              cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
              continue;
            }
          }
          const occ = atTime(cursor);
          if (inclusiveDay) {
            if (occ >= from && occ < until) return occ;
          } else if (occ >= from) {
            return occ;
          }
        }
        cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
      }
      return null;
    }
    return null;
  }

  function computeStreak(sessions) {
    const days = new Set(sessions.map((s) => s.date));
    let streak = 0;
    let cursor = new Date();
    while (true) {
      const iso = cursor.toISOString().slice(0, 10);
      if (days.has(iso)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  }

  /* =========================================================
     AI STUDY BUDDY
     ========================================================= */

  async function renderAI() {
    await ensureDefaultConversation();
    await renderConversationList();
    await renderMessages();
    bindAIComposer();
    updateAvatarMood("idle");
  }

  async function ensureDefaultConversation() {
    let convos = await DB.getAll("conversations");
    if (!convos.length) {
      const convo = { id: DB.uid(), title: "New chat", createdAt: Date.now() };
      await DB.put("conversations", convo);
      convos = [convo];
    }
    if (!state.activeConversationId) {
      convos.sort((a, b) => b.createdAt - a.createdAt);
      state.activeConversationId = convos[0].id;
    }
  }

  async function renderConversationList() {
    const convos = await DB.getAll("conversations");
    convos.sort((a, b) => b.createdAt - a.createdAt);
    const root = $("#conversationList");
    root.innerHTML = convos
      .map(
        (c) => `
      <button class="convo-item ${c.id === state.activeConversationId ? "active" : ""}" data-convo="${c.id}">
        <span>${escapeHtml(c.title)}</span>
      </button>`
      )
      .join("");
    $$("[data-convo]", root).forEach((btn) =>
      btn.addEventListener("click", async () => {
        state.activeConversationId = btn.dataset.convo;
        await renderConversationList();
        await renderMessages();
      })
    );
  }

  async function renderMessages() {
    const all = await DB.getAll("messages");
    const msgs = all
      .filter((m) => m.conversationId === state.activeConversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const root = $("#chatMessages");
    if (!msgs.length) {
      root.innerHTML = `<div class="empty-state small"><span>🤖</span><p>Say hi, or tap a quick action below to get started.</p></div>`;
      return;
    }
    root.innerHTML = msgs
      .map(
        (m) => `
      <div class="chat-msg ${m.role}">
        <div class="bubble">${renderMarkdownLite(m.text)}</div>
        <time>${new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </div>`
      )
      .join("");
    root.scrollTop = root.scrollHeight;
  }

  function renderMarkdownLite(text) {
    let safe = escapeHtml(text);
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\n/g, "<br/>");
    return safe;
  }

  let aiComposerBound = false;
  function bindAIComposer() {
    if (aiComposerBound) return;
    aiComposerBound = true;

    $("#chatForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#chatInput");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await sendUserMessage(text);
    });

    $("#newConvoBtn").addEventListener("click", async () => {
      const convo = { id: DB.uid(), title: "New chat", createdAt: Date.now() };
      await DB.put("conversations", convo);
      state.activeConversationId = convo.id;
      await renderConversationList();
      await renderMessages();
    });

    $("#clearChatBtn").addEventListener("click", async () => {
      if (!confirm("Clear this conversation? This cannot be undone.")) return;
      const all = await DB.getAll("messages");
      for (const m of all.filter((m) => m.conversationId === state.activeConversationId)) {
        await DB.remove("messages", m.id);
      }
      await renderMessages();
    });

    $$(".quick-action").forEach((btn) =>
      btn.addEventListener("click", () => sendUserMessage(btn.dataset.prompt))
    );
  }

  async function sendUserMessage(text) {
    const userMsg = {
      id: DB.uid(),
      conversationId: state.activeConversationId,
      role: "user",
      text,
      createdAt: Date.now(),
    };
    await DB.put("messages", userMsg);
    await renderMessages();

    // Auto-title new conversations from the first message
    const convo = await DB.getOne("conversations", state.activeConversationId);
    if (convo && convo.title === "New chat") {
      convo.title = text.slice(0, 40);
      await DB.put("conversations", convo);
      await renderConversationList();
    }

    updateAvatarMood("thinking");
    setTypingIndicator(true);

    const ctx = {
      subject: state.settings.subjects?.[0] || "",
      lesson: state.settings.lesson || "",
      grade: state.settings.grade || "",
      curriculum: state.settings.curriculum || "",
    };
    const history = (await DB.getAll("messages")).filter((m) => m.conversationId === state.activeConversationId);
    const result = await AI.reply(text, ctx, history);

    setTypingIndicator(false);
    const aiMsg = {
      id: DB.uid(),
      conversationId: state.activeConversationId,
      role: "assistant",
      text: result.text,
      createdAt: Date.now(),
    };
    await DB.put("messages", aiMsg);
    await renderMessages();
    updateAvatarMood(/🎉|nice|great/i.test(result.text) ? "celebrate" : "idle");
    await checkAchievements();
  }

  function setTypingIndicator(show) {
    const el = $("#typingIndicator");
    el.classList.toggle("hidden", !show);
    if (show) $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
  }

  function updateAvatarMood(mood) {
    $$(".ai-avatar").forEach((av) => {
      av.setAttribute("data-mood", mood);
    });
  }

  /* =========================================================
     PLANS — CLASSES + TASKS
     ========================================================= */

  async function renderPlans() {
    await renderClassList();
    await renderTaskList();
    bindPlansUI();
  }

  let plansUIBound = false;
  function bindPlansUI() {
    if (plansUIBound) return;
    plansUIBound = true;

    $("#addClassBtn").addEventListener("click", () => openClassModal());
    $("#addTaskBtn").addEventListener("click", () => openTaskModal());

    $$(".task-filter").forEach((btn) =>
      btn.addEventListener("click", () => {
        $$(".task-filter").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.tasksFilter = btn.dataset.filter;
        renderTaskList();
      })
    );

    $("#classForm").addEventListener("submit", handleClassFormSubmit);
    $("#taskForm").addEventListener("submit", handleTaskFormSubmit);
    $$("[data-close-modal]").forEach((btn) =>
      btn.addEventListener("click", (e) => closeModal(e.target.closest(".modal").id))
    );
    $("#classRepeat").addEventListener("change", (e) => {
      $("#classDayOfWeekWrap").classList.toggle("hidden", e.target.value === "none" || e.target.value === "daily");
    });
  }

  async function renderClassList() {
    const classes = await DB.getAll("classes");
    const root = $("#classList");
    if (!classes.length) {
      root.innerHTML = `<div class="empty-state small"><span>📅</span><p>No classes planned yet.</p></div>`;
      return;
    }
    classes.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    root.innerHTML = classes
      .map((c) => {
        const repeatLabel = {
          none: "One-time",
          daily: "Every day",
          weekly: "Weekly",
          biweekly: "Every 2 weeks",
          custom: "Custom",
        }[c.repeat || "none"];
        return `
        <div class="class-card" style="--accent:${c.color || "var(--electric-blue)"}">
          <div class="class-card-top">
            <strong>${escapeHtml(c.name)}</strong>
            <div class="row-actions">
              <button class="icon-btn" data-edit-class="${c.id}" aria-label="Edit class">✏️</button>
              <button class="icon-btn" data-del-class="${c.id}" aria-label="Delete class">🗑️</button>
            </div>
          </div>
          <p class="muted">${escapeHtml(c.teacher || "")}</p>
          <div class="class-card-meta">
            <span>🕒 ${c.startTime || "--"}${c.endTime ? "–" + c.endTime : ""}</span>
            <span>🔁 ${repeatLabel}</span>
          </div>
          ${c.notes ? `<p class="class-notes">${escapeHtml(c.notes)}</p>` : ""}
        </div>`;
      })
      .join("");

    $$("[data-edit-class]", root).forEach((btn) =>
      btn.addEventListener("click", async () => openClassModal(await DB.getOne("classes", btn.dataset.editClass)))
    );
    $$("[data-del-class]", root).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this class?")) return;
        Notifications.cancel("class-" + btn.dataset.delClass);
        await DB.remove("classes", btn.dataset.delClass);
        toast("Class deleted");
        renderClassList();
        renderHome();
      })
    );
  }

  function openClassModal(existing) {
    const form = $("#classForm");
    form.reset();
    $("#classModalTitle").textContent = existing ? "Edit Class" : "Add Class";
    form.elements.id.value = existing?.id || "";
    form.elements.name.value = existing?.name || "";
    form.elements.subject.value = existing?.subject || "";
    form.elements.teacher.value = existing?.teacher || "";
    form.elements.date.value = existing?.date || todayISO();
    form.elements.startTime.value = existing?.startTime || "16:00";
    form.elements.endTime.value = existing?.endTime || "";
    form.elements.repeat.value = existing?.repeat || "none";
    form.elements.dayOfWeek.value = existing?.dayOfWeek ?? new Date().getDay();
    form.elements.color.value = existing?.color || "#5B6EF5";
    form.elements.notes.value = existing?.notes || "";
    $("#classDayOfWeekWrap").classList.toggle(
      "hidden",
      (existing?.repeat || "none") === "none" || existing?.repeat === "daily"
    );
    openModal("classModal");
  }

  async function handleClassFormSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const cls = {
      id: f.elements.id.value || DB.uid(),
      name: f.elements.name.value.trim(),
      subject: f.elements.subject.value.trim(),
      teacher: f.elements.teacher.value.trim(),
      date: f.elements.date.value,
      startTime: f.elements.startTime.value,
      endTime: f.elements.endTime.value,
      repeat: f.elements.repeat.value,
      dayOfWeek: Number(f.elements.dayOfWeek.value),
      color: f.elements.color.value,
      notes: f.elements.notes.value.trim(),
    };
    if (!cls.name || !cls.startTime) {
      toast("Please fill in the class name and start time", "error");
      return;
    }
    await DB.put("classes", cls);
    closeModal("classModal");
    toast("Class saved");
    scheduleClassReminder(cls);
    await renderClassList();
    await renderHome();
  }

  async function renderTaskList() {
    const tasks = await DB.getAll("tasks");
    const today = todayISO();
    let filtered = tasks;
    if (state.tasksFilter === "today") filtered = tasks.filter((t) => t.dueDate === today);
    else if (state.tasksFilter === "upcoming") filtered = tasks.filter((t) => t.dueDate > today && !t.completed);
    else if (state.tasksFilter === "completed") filtered = tasks.filter((t) => t.completed);
    else if (state.tasksFilter === "high") filtered = tasks.filter((t) => t.priority === "high");

    filtered.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return (a.dueDate || "").localeCompare(b.dueDate || "");
    });

    const root = $("#taskList");
    if (!filtered.length) {
      root.innerHTML = `<div class="empty-state small"><span>🎉</span><p>You're all clear! Nothing here.</p></div>`;
      return;
    }
    const prioIcon = { high: "🔴", medium: "🟡", low: "🟢" };
    root.innerHTML = filtered
      .map(
        (t) => `
      <div class="task-item ${t.completed ? "done" : ""}" data-task="${t.id}">
        <label class="task-check">
          <input type="checkbox" data-task-toggle="${t.id}" ${t.completed ? "checked" : ""}/>
          <span class="check-visual"></span>
        </label>
        <div class="task-main">
          <strong>${escapeHtml(t.title)}</strong>
          <div class="task-meta">
            ${t.subject ? `<span class="chip-sm">${escapeHtml(t.subject)}</span>` : ""}
            ${t.dueDate ? `<span>📅 ${t.dueDate}${t.dueTime ? " " + t.dueTime : ""}</span>` : ""}
            <span>${prioIcon[t.priority]} ${t.priority}</span>
          </div>
          ${t.notes ? `<p class="task-notes">${escapeHtml(t.notes)}</p>` : ""}
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-edit-task="${t.id}" aria-label="Edit task">✏️</button>
          <button class="icon-btn" data-del-task="${t.id}" aria-label="Delete task">🗑️</button>
        </div>
      </div>`
      )
      .join("");

    $$("[data-task-toggle]", root).forEach((el) =>
      el.addEventListener("change", async (e) => {
        const item = e.target.closest(".task-item");
        if (e.target.checked) item.classList.add("celebrate");
        await toggleTaskComplete(e.target.dataset.taskToggle);
        setTimeout(() => renderTaskList(), item ? 450 : 0);
        renderHome();
        checkAchievements();
      })
    );
    $$("[data-edit-task]", root).forEach((btn) =>
      btn.addEventListener("click", async () => openTaskModal(await DB.getOne("tasks", btn.dataset.editTask)))
    );
    $$("[data-del-task]", root).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this task?")) return;
        Notifications.cancel("task-" + btn.dataset.delTask);
        await DB.remove("tasks", btn.dataset.delTask);
        toast("Task deleted");
        renderTaskList();
        renderHome();
      })
    );
  }

  async function toggleTaskComplete(id) {
    const task = await DB.getOne("tasks", id);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    await DB.put("tasks", task);
  }

  function openTaskModal(existing) {
    const form = $("#taskForm");
    form.reset();
    $("#taskModalTitle").textContent = existing ? "Edit Task" : "Add Task";
    form.elements.id.value = existing?.id || "";
    form.elements.title.value = existing?.title || "";
    form.elements.subject.value = existing?.subject || "";
    form.elements.dueDate.value = existing?.dueDate || todayISO();
    form.elements.dueTime.value = existing?.dueTime || "";
    form.elements.priority.value = existing?.priority || "medium";
    form.elements.notes.value = existing?.notes || "";
    form.elements.reminder.value = existing?.reminderMinutes ?? "0";
    openModal("taskModal");
  }

  async function handleTaskFormSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const task = {
      id: f.elements.id.value || DB.uid(),
      title: f.elements.title.value.trim(),
      subject: f.elements.subject.value.trim(),
      dueDate: f.elements.dueDate.value,
      dueTime: f.elements.dueTime.value,
      priority: f.elements.priority.value,
      notes: f.elements.notes.value.trim(),
      reminderMinutes: Number(f.elements.reminder.value),
      completed: f.elements.id.value ? (await DB.getOne("tasks", f.elements.id.value))?.completed || false : false,
    };
    if (!task.title) {
      toast("Please enter a task title", "error");
      return;
    }
    await DB.put("tasks", task);
    closeModal("taskModal");
    toast("Task saved");
    scheduleTaskReminder(task);
    await renderTaskList();
    await renderHome();
  }

  /* Reminder scheduling ---------------------------------- */

  async function scheduleAllClassReminders() {
    const classes = await DB.getAll("classes");
    classes.forEach(scheduleClassReminder);
  }

  function scheduleClassReminder(cls) {
    const minutesBefore = state.settings.classReminderMinutes ?? 15;
    if (!minutesBefore) return;
    const now = new Date();
    const horizon = new Date(now.getTime() + 8 * 24 * 3600 * 1000);
    const occ = nextOccurrenceOf(cls, now, horizon);
    if (!occ) return;
    const fireAt = occ.getTime() - minutesBefore * 60000;
    Notifications.scheduleAt("class-" + cls.id, fireAt, () => {
      Notifications.notify(
        `📚 ${cls.subject || cls.name} starts in ${minutesBefore} minutes!`,
        `${cls.name}${cls.teacher ? " · " + cls.teacher : ""}`,
        { kind: "class", tag: "class-" + cls.id }
      );
      scheduleClassReminder(cls); // queue the following occurrence
    });
  }

  async function scheduleAllTaskReminders() {
    const tasks = await DB.getAll("tasks");
    tasks.forEach(scheduleTaskReminder);
  }

  function scheduleTaskReminder(task) {
    if (!task.reminderMinutes || task.completed || !task.dueDate) return;
    const due = new Date(task.dueDate + "T" + (task.dueTime || "18:00"));
    const fireAt = due.getTime() - task.reminderMinutes * 60000;
    Notifications.scheduleAt("task-" + task.id, fireAt, () => {
      Notifications.notify(`✅ ${task.title}`, `Due ${task.dueTime ? "at " + task.dueTime : "today"}`, {
        kind: "task",
        tag: "task-" + task.id,
      });
    });
  }

  /* =========================================================
     NOTES
     ========================================================= */

  async function renderNotes() {
    await renderNoteList();
    bindNotesUI();
  }

  let notesUIBound = false;
  function bindNotesUI() {
    if (notesUIBound) return;
    notesUIBound = true;
    $("#addNoteBtn").addEventListener("click", () => openNoteModal());
    $("#noteSearch").addEventListener("input", (e) => {
      state.notesFilter.search = e.target.value.toLowerCase();
      renderNoteList();
    });
    $("#noteForm").addEventListener("submit", handleNoteFormSubmit);
  }

  async function renderNoteList() {
    let notes = await DB.getAll("notes");
    const { search } = state.notesFilter;
    if (search) {
      notes = notes.filter(
        (n) => n.title.toLowerCase().includes(search) || n.body.toLowerCase().includes(search)
      );
    }
    notes.sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);

    const root = $("#noteList");
    if (!notes.length) {
      root.innerHTML = `<div class="empty-state"><span>📝</span><p>Your study notes will live here.</p></div>`;
      return;
    }
    root.innerHTML = notes
      .map(
        (n) => `
      <div class="note-card" data-note="${n.id}">
        <div class="note-card-top">
          <strong>${n.pinned ? "📌 " : ""}${escapeHtml(n.title || "Untitled")}</strong>
          <button class="icon-btn" data-fav="${n.id}" aria-label="Toggle favorite">${n.favorite ? "⭐" : "☆"}</button>
        </div>
        <p class="note-preview">${escapeHtml((n.body || "").slice(0, 140))}</p>
        <div class="note-meta">
          ${n.subject ? `<span class="chip-sm">${escapeHtml(n.subject)}</span>` : ""}
          <time>${new Date(n.updatedAt).toLocaleDateString()}</time>
        </div>
      </div>`
      )
      .join("");

    $$(".note-card", root).forEach((card) =>
      card.addEventListener("click", async (e) => {
        if (e.target.closest("[data-fav]")) return;
        openNoteModal(await DB.getOne("notes", card.dataset.note));
      })
    );
    $$("[data-fav]", root).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const note = await DB.getOne("notes", btn.dataset.fav);
        note.favorite = !note.favorite;
        await DB.put("notes", note);
        renderNoteList();
      })
    );
  }

  function openNoteModal(existing) {
    const form = $("#noteForm");
    form.reset();
    $("#noteModalTitle").textContent = existing ? "Edit Note" : "New Note";
    form.elements.id.value = existing?.id || "";
    form.elements.title.value = existing?.title || "";
    form.elements.subject.value = existing?.subject || "";
    form.elements.category.value = existing?.category || "";
    form.elements.body.value = existing?.body || "";
    form.elements.pinned.checked = !!existing?.pinned;
    $("#deleteNoteBtn").classList.toggle("hidden", !existing);
    $("#deleteNoteBtn").onclick = async () => {
      if (existing && confirm("Delete this note?")) {
        await DB.remove("notes", existing.id);
        closeModal("noteModal");
        toast("Note deleted");
        renderNoteList();
      }
    };
    openModal("noteModal");
  }

  async function handleNoteFormSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const note = {
      id: f.elements.id.value || DB.uid(),
      title: f.elements.title.value.trim(),
      subject: f.elements.subject.value.trim(),
      category: f.elements.category.value.trim(),
      body: f.elements.body.value,
      pinned: f.elements.pinned.checked,
      favorite: f.elements.id.value ? (await DB.getOne("notes", f.elements.id.value))?.favorite || false : false,
      createdAt: f.elements.id.value ? (await DB.getOne("notes", f.elements.id.value))?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
    };
    if (!note.title && !note.body) {
      toast("Add a title or some content first", "error");
      return;
    }
    await DB.put("notes", note);
    closeModal("noteModal");
    toast("Note saved");
    renderNoteList();
    checkAchievements();
  }

  /* =========================================================
     STUDY SESSION
     ========================================================= */

  async function renderSession() {
    bindSessionUI();
    renderTimerDisplay();
    renderSoundButtons();
    updateAvatarMood(state.timer.running ? "study" : "idle");
    $("#sessionSubjectInput").value = state.timer.subject || "";
  }

  let sessionUIBound = false;
  function bindSessionUI() {
    if (sessionUIBound) return;
    sessionUIBound = true;

    $$(".timer-mode-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (state.timer.running) return;
        $$(".timer-mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.timer.mode = btn.dataset.mode;
        $("#countdownPresets").classList.toggle("hidden", btn.dataset.mode !== "countdown");
        resetTimer();
      })
    );

    $$(".countdown-preset").forEach((btn) =>
      btn.addEventListener("click", () => {
        $$(".countdown-preset").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const mins = btn.dataset.minutes === "custom" ? Number(prompt("Custom minutes:", "50")) || 50 : Number(btn.dataset.minutes);
        state.timer.targetMs = mins * 60000;
        state.timer.elapsed = 0;
        renderTimerDisplay();
      })
    );

    $("#timerStartBtn").addEventListener("click", startTimer);
    $("#timerPauseBtn").addEventListener("click", pauseTimer);
    $("#timerResumeBtn").addEventListener("click", startTimer);
    $("#timerStopBtn").addEventListener("click", stopTimer);
    $("#timerResetBtn").addEventListener("click", resetTimer);

    $("#soundUpload").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      Sounds.playUploaded(file);
      $$(".sound-btn").forEach((b) => b.classList.remove("active"));
      renderSoundNowPlaying("🎵 " + file.name);
    });

    $("#soundVolume").addEventListener("input", (e) => Sounds.setVolume(e.target.value / 100));
    $("#soundStopBtn").addEventListener("click", () => {
      Sounds.stopAll();
      $$(".sound-btn").forEach((b) => b.classList.remove("active"));
      renderSoundNowPlaying(null);
    });
  }

  function renderSoundButtons() {
    const root = $("#soundGrid");
    root.innerHTML = Sounds.PRESETS.map(
      (p) => `<button class="sound-btn" data-sound="${p.id}"><span>${p.emoji}</span>${p.label}</button>`
    ).join("");
    $$(".sound-btn", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        $$(".sound-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        Sounds.playGenerated(btn.dataset.sound);
        renderSoundNowPlaying(btn.textContent);
      })
    );
  }

  function renderSoundNowPlaying(label) {
    $("#soundNowPlaying").textContent = label ? "Now playing: " + label : "No sound playing";
  }

  function startTimer() {
    if (state.timer.running) return;
    state.timer.running = true;
    state.timer.startedAt = Date.now() - state.timer.elapsed;
    state.timer.subject = $("#sessionSubjectInput").value.trim();
    countdownWarnedEnd = false;
    timerInterval = setInterval(timerTick, 250);
    updateTimerButtons();
    updateAvatarMood("study");
  }

  function pauseTimer() {
    state.timer.running = false;
    clearInterval(timerInterval);
    updateTimerButtons();
    updateAvatarMood("idle");
  }

  function timerTick() {
    state.timer.elapsed = Date.now() - state.timer.startedAt;
    if (state.timer.mode === "countdown") {
      const remaining = state.timer.targetMs - state.timer.elapsed;
      if (remaining <= 0 && !countdownWarnedEnd) {
        countdownWarnedEnd = true;
        Notifications.notify("⏱️ Time's up!", "Your countdown session finished. Great focus!", { kind: "study" });
        pauseTimer();
      }
    }
    renderTimerDisplay();
  }

  function renderTimerDisplay() {
    const el = $("#timerDisplay");
    if (!el) return;
    let displayMs = state.timer.elapsed;
    if (state.timer.mode === "countdown") {
      displayMs = Math.max(0, state.timer.targetMs - state.timer.elapsed);
    }
    el.textContent = fmtTime(displayMs);
    updateTimerButtons();
  }

  function updateTimerButtons() {
    $("#timerStartBtn").classList.toggle("hidden", state.timer.running || state.timer.elapsed > 0);
    $("#timerResumeBtn").classList.toggle("hidden", state.timer.running || state.timer.elapsed === 0);
    $("#timerPauseBtn").classList.toggle("hidden", !state.timer.running);
    $("#timerStopBtn").classList.toggle("hidden", state.timer.elapsed === 0);
  }

  async function stopTimer() {
    clearInterval(timerInterval);
    const durationMs = state.timer.elapsed;
    const wasRunning = state.timer.running;
    state.timer.running = false;

    if (durationMs > 5000) {
      const session = {
        id: DB.uid(),
        date: todayISO(),
        durationMs,
        subject: state.timer.subject || $("#sessionSubjectInput").value.trim() || "General",
        mode: state.timer.mode,
        notes: "",
        createdAt: Date.now(),
      };
      await DB.put("sessions", session);
      toast(`Session saved: ${fmtDuration(durationMs)}`);
      updateAvatarMood("celebrate");
      await Notifications.notify("🥳 Session complete!", `You studied ${fmtDuration(durationMs)}. Nice work.`, {
        kind: "study",
      });
      await checkAchievements();
      renderHome();
      renderProgress();
    }
    resetTimer();
  }

  function resetTimer() {
    clearInterval(timerInterval);
    state.timer.running = false;
    state.timer.elapsed = 0;
    state.timer.startedAt = null;
    renderTimerDisplay();
  }

  /* =========================================================
     EXTRAS
     ========================================================= */

  async function renderExtras() {
    const extras = await DB.getAll("extras");
    const root = $("#extrasGrid");
    bindExtrasUI();
    if (!extras.length) {
      root.innerHTML = `<div class="empty-state"><span>✨</span><p>Add quick reminders, ideas, or small goals here.</p></div>`;
      return;
    }
    extras.sort((a, b) => b.createdAt - a.createdAt);
    root.innerHTML = extras
      .map(
        (x) => `
      <div class="extra-card">
        <div class="extra-card-top">
          <span class="chip-sm">${escapeHtml(x.type)}</span>
          <button class="icon-btn" data-del-extra="${x.id}">🗑️</button>
        </div>
        <strong>${escapeHtml(x.title)}</strong>
        ${x.body ? `<p>${escapeHtml(x.body)}</p>` : ""}
      </div>`
      )
      .join("");
    $$("[data-del-extra]", root).forEach((btn) =>
      btn.addEventListener("click", async () => {
        await DB.remove("extras", btn.dataset.delExtra);
        renderExtras();
      })
    );
  }

  let extrasUIBound = false;
  function bindExtrasUI() {
    if (extrasUIBound) return;
    extrasUIBound = true;
    $("#addExtraBtn").addEventListener("click", () => openModal("extraModal"));
    $("#extraForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const extra = {
        id: DB.uid(),
        type: f.elements.type.value,
        title: f.elements.title.value.trim(),
        body: f.elements.body.value.trim(),
        createdAt: Date.now(),
      };
      if (!extra.title) return;
      await DB.put("extras", extra);
      f.reset();
      closeModal("extraModal");
      renderExtras();
    });
  }

  /* =========================================================
     PROGRESS
     ========================================================= */

  async function renderProgress() {
    const [sessions, tasks, classes] = await Promise.all([
      DB.getAll("sessions"),
      DB.getAll("tasks"),
      DB.getAll("classes"),
    ]);

    const totalMs = sessions.reduce((s, x) => s + x.durationMs, 0);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const weekMs = sessions.filter((s) => s.createdAt >= weekAgo).reduce((s, x) => s + x.durationMs, 0);
    const streak = computeStreak(sessions);
    const completedTasks = tasks.filter((t) => t.completed).length;

    $("#progTotalTime").textContent = fmtDuration(totalMs);
    $("#progWeekTime").textContent = fmtDuration(weekMs);
    $("#progStreak").textContent = streak;
    $("#progTasksDone").textContent = completedTasks;
    $("#progSessions").textContent = sessions.length;

    const bySubject = {};
    sessions.forEach((s) => {
      bySubject[s.subject] = (bySubject[s.subject] || 0) + s.durationMs;
    });
    const topSubject = Object.entries(bySubject).sort((a, b) => b[1] - a[1])[0];
    $("#progTopSubject").textContent = topSubject ? topSubject[0] : "—";

    drawWeekChart(sessions);
    await renderAchievements();
  }

  function drawWeekChart(sessions) {
    const canvas = $("#weekChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 600;
    const cssHeight = 180;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = cssHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const totals = days.map((d) => {
      const iso = d.toISOString().slice(0, 10);
      return sessions.filter((s) => s.date === iso).reduce((sum, s) => sum + s.durationMs, 0);
    });
    const maxVal = Math.max(...totals, 1);
    const barWidth = cssWidth / days.length;
    const styles = getComputedStyle(document.documentElement);
    ctx.fillStyle = styles.getPropertyValue("--electric-blue").trim() || "#5B6EF5";

    totals.forEach((val, i) => {
      const barHeight = (val / maxVal) * (cssHeight - 30);
      const x = i * barWidth + barWidth * 0.2;
      const y = cssHeight - barHeight - 20;
      const w = barWidth * 0.6;
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(x, y + barHeight);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + barHeight);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = styles.getPropertyValue("--text-secondary").trim() || "#888";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(days[i].toLocaleDateString(undefined, { weekday: "short" })[0], x + w / 2, cssHeight - 6);
      ctx.fillStyle = styles.getPropertyValue("--electric-blue").trim() || "#5B6EF5";
    });
  }

  const ACHIEVEMENT_DEFS = [
    { id: "first-session", title: "First Study Session", emoji: "🌱", check: (d) => d.sessions.length >= 1 },
    { id: "streak-7", title: "7 Day Streak", emoji: "🔥", check: (d) => d.streak >= 7 },
    { id: "hours-10", title: "10 Hours Studied", emoji: "⏱️", check: (d) => d.totalMs >= 10 * 3600 * 1000 },
    { id: "task-master", title: "Task Master", emoji: "🏆", check: (d) => d.completedTasks >= 20 },
    { id: "early-bird", title: "Early Bird", emoji: "🌅", check: (d) => d.sessions.some((s) => new Date(s.createdAt).getHours() < 8) },
    { id: "note-taker", title: "Note Taker", emoji: "📝", check: (d) => d.notes.length >= 5 },
  ];

  async function checkAchievements() {
    const [sessions, tasks, notes, unlocked] = await Promise.all([
      DB.getAll("sessions"),
      DB.getAll("tasks"),
      DB.getAll("notes"),
      DB.getAll("achievements"),
    ]);
    const unlockedIds = new Set(unlocked.map((a) => a.id));
    const data = {
      sessions,
      totalMs: sessions.reduce((s, x) => s + x.durationMs, 0),
      streak: computeStreak(sessions),
      completedTasks: tasks.filter((t) => t.completed).length,
      notes,
    };
    for (const def of ACHIEVEMENT_DEFS) {
      if (!unlockedIds.has(def.id) && def.check(data)) {
        await DB.put("achievements", { id: def.id, unlockedAt: Date.now() });
        await Notifications.notify(`🏆 Achievement unlocked: ${def.title}`, "Keep up the great work!", {
          kind: "achievement",
        });
      }
    }
    if (state.section === "progress") renderAchievements();
  }

  async function renderAchievements() {
    const unlocked = await DB.getAll("achievements");
    const unlockedIds = new Set(unlocked.map((a) => a.id));
    const root = $("#achievementGrid");
    root.innerHTML = ACHIEVEMENT_DEFS.map((def) => {
      const isUnlocked = unlockedIds.has(def.id);
      return `
      <div class="achievement-card ${isUnlocked ? "unlocked" : "locked"}">
        <span class="achievement-emoji">${def.emoji}</span>
        <strong>${def.title}</strong>
      </div>`;
    }).join("");
  }

  /* =========================================================
     SETTINGS
     ========================================================= */

  async function renderSettings() {
    const s = state.settings;
    $("#settingsForm").elements.name.value = s.name || "";
    $("#settingsForm").elements.grade.value = s.grade || "";
    $("#settingsForm").elements.curriculum.value = s.curriculum || "";
    $("#settingsForm").elements.term.value = s.term || "";
    $("#settingsForm").elements.subjects.value = (s.subjects || []).join(", ");
    $("#settingsForm").elements.lesson.value = s.lesson || "";
    $("#settingsForm").elements.theme.value = s.theme || "system";
    $("#settingsForm").elements.aiPersonality.value = s.aiPersonality || "friendly";
    $("#settingsForm").elements.aiBackendUrl.value = s.aiBackendUrl || "";
    $("#settingsForm").elements.classReminderMinutes.value = s.classReminderMinutes ?? 15;
    $("#notifClass").checked = s.notif_enabled_class !== false;
    $("#notifTask").checked = s.notif_enabled_task !== false;
    $("#notifStudy").checked = s.notif_enabled_study !== false;
    $("#notifAchievement").checked = s.notif_enabled_achievement !== false;

    const perm = await Notifications.permissionState();
    $("#notifPermStatus").textContent =
      perm === "granted" ? "✅ Enabled" : perm === "denied" ? "🚫 Blocked in browser settings" : "Not enabled yet";

    bindSettingsUI();
  }

  let settingsUIBound = false;
  function bindSettingsUI() {
    if (settingsUIBound) return;
    settingsUIBound = true;

    $("#settingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      Object.assign(state.settings, {
        name: f.elements.name.value.trim() || "Student",
        grade: f.elements.grade.value.trim(),
        curriculum: f.elements.curriculum.value.trim(),
        term: f.elements.term.value.trim(),
        subjects: f.elements.subjects.value.split(",").map((s) => s.trim()).filter(Boolean),
        lesson: f.elements.lesson.value.trim(),
        theme: f.elements.theme.value,
        aiPersonality: f.elements.aiPersonality.value,
        aiBackendUrl: f.elements.aiBackendUrl.value.trim(),
        classReminderMinutes: Number(f.elements.classReminderMinutes.value),
        notif_enabled_class: $("#notifClass").checked,
        notif_enabled_task: $("#notifTask").checked,
        notif_enabled_study: $("#notifStudy").checked,
        notif_enabled_achievement: $("#notifAchievement").checked,
      });
      await saveSettings();
      applyTheme();
      toast("Settings saved");
      renderHome();
      scheduleAllClassReminders();
    });

    $("#enableNotifBtn").addEventListener("click", async () => {
      const result = await Notifications.requestPermission();
      toast(result === "granted" ? "Notifications enabled 🎉" : "Notifications not enabled");
      renderSettings();
    });

    $("#exportDataBtn").addEventListener("click", async () => {
      const dump = await DB.exportAll();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `study-buddy-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Data exported");
    });

    $("#importDataInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const dump = JSON.parse(text);
        await DB.importAll(dump);
        toast("Data imported — reloading…");
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        toast("Could not read that file", "error");
      }
      e.target.value = "";
    });

    $("#clearDataBtn").addEventListener("click", async () => {
      if (!confirm("This will permanently delete ALL your Study Buddy data. Are you sure?")) return;
      if (!confirm("Really sure? This cannot be undone.")) return;
      await DB.wipeAll();
      toast("All data cleared");
      setTimeout(() => location.reload(), 800);
    });
  }

  /* =========================================================
     MODALS
     ========================================================= */

  function openModal(id) {
    $("#" + id).classList.add("open");
  }
  function closeModal(id) {
    $("#" + id).classList.remove("open");
  }

  return { init, goTo, toast };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init().catch((err) => {
    console.error("Failed to initialize Study Buddy:", err);
  });
});
