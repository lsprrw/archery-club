const API_URL = "http://localhost:3000/api";
let editingSubscriptionId = null;
let editingTrainingId = null;

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const cleanMessage = String(data.message || "Ошибка запроса")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    throw new Error(cleanMessage || "Ошибка запроса");
  }

  return data;
}

async function loadDataFromServer() {
  const [
    participants,
    trainers,
    subscriptions,
    inventory,
    trainings,
    results,
  ] = await Promise.all([
    apiRequest(`${API_URL}/participants`),
    apiRequest(`${API_URL}/trainers`),
    apiRequest(`${API_URL}/subscriptions`),
    apiRequest(`${API_URL}/inventory`),
    apiRequest(`${API_URL}/trainings`),
    apiRequest(`${API_URL}/results`),
  ]);

  state.participants = Array.isArray(participants) ? participants : [];
  state.trainers = Array.isArray(trainers) ? trainers : [];
  state.subscriptions = Array.isArray(subscriptions) ? subscriptions : [];
  state.inventory = Array.isArray(inventory) ? inventory : [];
  state.trainings = Array.isArray(trainings) ? trainings : [];
  state.results = Array.isArray(results) ? results : [];
}

const state = {
  currentUser: null,
  participants: [],
  trainers: [],
  subscriptions: [],
  inventory: [],
  trainings: [],
  results: [],
  selectedTrainingId: null,
  selectedResultsParticipantId: null,
};

const rolePermissions = {
  admin: ["dashboard", "participants", "subscriptionsInfo", "inventory", "training", "results"],
  trainer: ["dashboard", "training", "results"],
  participant: ["participantProfile", "subscriptionsInfo", "training", "results"],
};

const roleTitles = {
  admin: "Администратор",
  trainer: "Тренер",
  participant: "Участник",
};

const sectionMap = {
  dashboard: "dashboardSection",
  participants: "participantsSection",
  inventory: "inventorySection",
  training: "trainingSection",
  results: "resultsSection",
  participantProfile: "participantProfileSection",
  subscriptionsInfo: "subscriptionsInfoSection",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadDataFromServer();
  normalizeData();
  bindEvents();
  restoreSession();
  renderPublicContent();
  renderAll();
  renderPublicHeader();
}

function normalizeData() {
  state.subscriptions = state.subscriptions.map((sub) => ({
    ...sub,
    visits: Number(sub.visits) || 0,
    accessLevel: sub.accessLevel || "full",
    description: sub.description || "",
  }));

  state.trainings = state.trainings.map((training, index) => ({
    ...training,
    id: training.id || Date.now() + index,
    endTime: training.endTime || addHoursToTime(training.time, 1),
    comment: training.comment || "",
    slots: Number(training.slots) || 10,
    trainerId: training.trainerId || state.trainers.find((trainer) => trainer.name === training.trainer)?.id || "",
    participants: Array.isArray(training.participants) ? training.participants.map(Number) : [],
    confirmed: Array.isArray(training.confirmed) ? training.confirmed.map(Number) : [],
    attended: Array.isArray(training.attended) ? training.attended.map(Number) : [],
    accessLevel: training.accessLevel || (/ознаком/i.test(training.title || "") ? "trial" : "full"),
  }));

  state.results = state.results.map((result, index) => ({
    ...result,
    id: result.id || Date.now() + 1000 + index,
    participantId: Number(result.participantId),
    trainingId: Number(result.trainingId),
    score: Number(result.score) || 0,
    comment: result.comment || "",
  }));

  state.participants = state.participants.map((participant) => ({
    ...participant,
    id: Number(participant.id),
    remaining: Number(participant.remaining) || 0,
    role: participant.role || "participant",
    subscription: participant.subscription || "Пробное занятие",
    trialOnly: typeof participant.trialOnly === "boolean"
      ? participant.trialOnly
      : participant.subscriptionAccessLevel === "trial" || participant.subscription === "Пробное занятие",
    assignedByAdmin: typeof participant.assignedByAdmin === "boolean"
      ? participant.assignedByAdmin
      : participant.subscriptionAccessLevel !== "trial" && participant.subscription !== "Пробное занятие",
  }));
}

function addHoursToTime(time, hoursToAdd) {
  const [hours, minutes] = String(time || "18:00").split(":").map(Number);
  const date = new Date(2026, 0, 1, hours || 0, minutes || 0);
  date.setHours(date.getHours() + hoursToAdd);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function bindEvents() {
  const safeBind = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  };

  safeBind("heroLoginBtn", "click", () => openAuth("login"));
  safeBind("heroRegisterBtn", "click", () => openAuth("register"));
  safeBind("loginTabBtn", "click", () => switchAuthTab("login"));
  safeBind("registerTabBtn", "click", () => switchAuthTab("register"));
  safeBind("loginForm", "submit", handleLogin);
  safeBind("registerForm", "submit", handleRegister);
  safeBind("logoutBtn", "click", logout);
  safeBind("goToSubscriptionsBtn", "click", () => showSection("subscriptionsInfo"));
  safeBind("menuToggle", "click", toggleSidebar);
  safeBind("participantSearch", "input", renderParticipantsTable);
  safeBind("openCreateParticipantModalBtn", "click", openParticipantModal);
  safeBind("closeParticipantModalBtn", "click", closeParticipantModal);
  safeBind("refreshScheduleBtn", "click", renderTrainingModule);
  safeBind("openSubscriptionModalBtn", "click", () => openSubscriptionModal());
  safeBind("closeSubscriptionModalBtn", "click", closeSubscriptionModal);
  safeBind("subscriptionFormModalForm", "submit", saveSubscriptionFromModal);
  safeBind("openTrainingModalBtn", "click", () => openTrainingModal());
  safeBind("closeTrainingModalBtn", "click", closeTrainingModal);
  safeBind("trainingFormModalForm", "submit", saveTrainingFromModal);
  safeBind("resultForm", "submit", saveResult);
  safeBind("resultsSearch", "input", renderResultsModule);
  safeBind("participantProfileForm", "submit", saveParticipantProfile);
  safeBind("createParticipantForm", "submit", handleCreateParticipant);

  const subscriptionModal = document.getElementById("subscriptionModal");
  if (subscriptionModal) {
    subscriptionModal.addEventListener("click", (event) => {
      if (event.target === subscriptionModal) closeSubscriptionModal();
    });
  }

  const trainingModal = document.getElementById("trainingModal");
  if (trainingModal) {
    trainingModal.addEventListener("click", (event) => {
      if (event.target === trainingModal) closeTrainingModal();
    });
  }

  const modal = document.getElementById("participantModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeParticipantModal();
    });
  }
}

function renderPublicHeader() {
  return;
}

function restoreSession() {
  const savedUser = localStorage.getItem("archeryCurrentUser");
  if (savedUser) {
    state.currentUser = JSON.parse(savedUser);
    showMainScreen();
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  const auth = document.getElementById("authScreen");
  const main = document.getElementById("mainScreen");
  const publicScreen = document.getElementById("publicScreen");
  if (publicScreen) publicScreen.classList.remove("active");
  if (auth) auth.classList.add("active");
  if (main) main.classList.remove("active");
}

function showMainScreen() {
  const auth = document.getElementById("authScreen");
  const main = document.getElementById("mainScreen");
  const publicScreen = document.getElementById("publicScreen");
  if (publicScreen) publicScreen.classList.remove("active");
  if (auth) auth.classList.remove("active");
  if (main) main.classList.add("active");
}

function openAuth(tab) {
  showAuthScreen();
  switchAuthTab(tab);
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  document.getElementById("loginTabBtn").classList.toggle("active", isLogin);
  document.getElementById("registerTabBtn").classList.toggle("active", !isLogin);
  document.getElementById("loginPanel").classList.toggle("active", isLogin);
  document.getElementById("registerPanel").classList.toggle("active", !isLogin);
}

async function handleLogin(e) {
  e.preventDefault();

  const login = document.getElementById("login").value.trim();
  const password = document.getElementById("password").value.trim();

  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка входа");
    return;
  }

  state.currentUser = data;
  localStorage.setItem("archeryCurrentUser", JSON.stringify(data));

  await loadDataFromServer();
  normalizeData();

  showMainScreen();
  renderAll();
  renderPublicHeader();
}

async function handleRegister(e) {
  e.preventDefault();

  const name = document.getElementById("registerName").value.trim();
  const age = Number(document.getElementById("registerAge").value);
  const login = document.getElementById("registerLogin").value.trim();
  const password = document.getElementById("registerPassword").value.trim();

  if (!name || !age || !login || !password) {
    alert("Заполните все поля.");
    return;
  }

  const response = await fetch(`${API_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, age, login, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка регистрации");
    return;
  }

  alert("Регистрация прошла успешно. Теперь войдите в систему.");

  document.getElementById("registerForm").reset();
  switchAuthTab("login");
  document.getElementById("login").value = login;
  document.getElementById("password").value = password;

  await loadDataFromServer();
  normalizeData();
}

function logout() {
  localStorage.removeItem("archeryCurrentUser");
  state.currentUser = null;
  showAuthScreen();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 860) {
    document.getElementById("sidebar").classList.remove("open");
  }
}

function renderPublicContent() {
  return;
}

function renderAll() {
  renderPublicContent();
  if (!state.currentUser) return;
  renderUserInfo();
  renderNavigation();
  renderDashboard();
  renderParticipantsTable();
  renderSubscriptionsInfo();
  renderInventoryTable();
  renderTrainingModule();
  renderResultsModule();
  renderAdminCreateForm();
  if (state.currentUser.role === "participant") {
    const ownParticipant = state.participants.find((p) => p.name === state.currentUser.name);
    if (ownParticipant) renderParticipantProfile(ownParticipant);
  }
  showSection(getDefaultSection());
}

function renderUserInfo() {
  const userInfo = document.getElementById("userInfo");
  if (!userInfo) return;
  userInfo.textContent = `${state.currentUser.name} · ${roleTitles[state.currentUser.role]}`;
}

function getDefaultSection() {
  if (state.currentUser.role === "participant") return "participantProfile";
  return rolePermissions[state.currentUser.role][0];
}

function renderNavigation() {
  const nav = document.getElementById("navMenu");
  if (!nav) return;
  nav.innerHTML = "";

  const items = [
    { key: "dashboard", label: "Главная" },
    { key: "participantProfile", label: "Профиль" },
    { key: "subscriptionsInfo", label: "Абонементы и услуги" },
    { key: "participants", label: "Участники" },
    { key: "inventory", label: "Инвентарь" },
    { key: "training", label: "Тренировки" },
    { key: "results", label: "Результаты тренировок" },
  ];

  items
    .filter((item) => rolePermissions[state.currentUser.role].includes(item.key))
    .forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = item.key;
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        showSection(item.key);
        closeSidebarOnMobile();
      });
      nav.appendChild(btn);
    });
}

function showSection(sectionKey) {
  const allowed = rolePermissions[state.currentUser.role];
  const extraAllowed = ["participantProfile"];
  if (!allowed.includes(sectionKey) && !extraAllowed.includes(sectionKey)) {
    alert("У вас нет доступа к этому разделу.");
    return;
  }

  document.querySelectorAll(".page-section").forEach((section) => section.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.section === sectionKey) item.classList.add("active");
  });

  const sectionId = sectionMap[sectionKey];
  if (sectionId) {
    document.getElementById(sectionId).classList.add("active");
  }
}

function renderDashboard() {
  const container = document.getElementById("dashboardCards");
  if (!container) return;
  container.innerHTML = "";

  const activeParticipants = state.participants.filter((p) => !p.blocked).length;
  const blockedParticipants = state.participants.filter((p) => p.blocked).length;
  const availableInventory = state.inventory.filter((i) => i.status === "available").length;
  const visibleTrainings = getVisibleTrainingsForCurrentUser();
  const resultsCount = state.currentUser.role === "trainer"
    ? state.results.filter((r) => canEditResultForParticipantTraining(r.participantId, r.trainingId, true)).length
    : state.results.length;

  const cards = [
    { title: "Активные участники", value: activeParticipants },
    { title: "Заблокированные участники", value: blockedParticipants },
    { title: "Свободный инвентарь", value: availableInventory },
    { title: state.currentUser.role === "trainer" ? "Мои тренировки" : "Запланированные тренировки", value: visibleTrainings.length },
    {
      title: state.currentUser.role === "trainer" ? "Мои подопечные" : "Отмеченные посещения",
      value: state.currentUser.role === "trainer"
        ? getVisibleResultsParticipants().length
        : state.trainings.reduce((acc, t) => acc + t.attended.length, 0),
    },
    { title: state.currentUser.role === "trainer" ? "Доступные результаты" : "Сохраненные результаты", value: resultsCount },
  ];

  cards.forEach((card) => {
    const el = document.createElement("article");
    el.className = "stat-card";
    el.innerHTML = `<h4>${card.title}</h4><div class="value">${card.value}</div>`;
    container.appendChild(el);
  });
}

function renderParticipantsTable() {
  const table = document.getElementById("participantsTable");
  const searchInput = document.getElementById("participantSearch");
  const adminCreateCard = document.getElementById("adminParticipantCreateCard");
  if (!table) return;

  if (searchInput) searchInput.parentElement.style.display = state.currentUser.role === "admin" || state.currentUser.role === "participant" ? "block" : "none";
  if (adminCreateCard) adminCreateCard.style.display = state.currentUser.role === "admin" ? "block" : "none";

  if (state.currentUser.role === "trainer") {
    table.innerHTML = `<tr><td colspan="8" class="muted">Раздел участников для тренера пока скрыт. Работа с подопечными доступна в разделах «Тренировки» и «Результаты тренировок».</td></tr>`;
    return;
  }

  const search = String(searchInput?.value || "").trim().toLowerCase();
  let data = [...state.participants];

  if (state.currentUser.role === "participant") {
    const ownParticipant = state.participants.find((p) => p.name === state.currentUser.name);
    data = ownParticipant ? [ownParticipant] : [];
  }
  if (search) {
    data = data.filter((participant) => participant.name.toLowerCase().includes(search));
  }

  table.innerHTML = data.map((participant) => {
    const statusBadge = participant.blocked
      ? '<span class="badge badge-danger">Заблокирован</span>'
      : '<span class="badge badge-success">Активен</span>';
    const actionsHtml = `
      <div class="actions">
        <button class="btn btn-outline btn-small" onclick="viewProfile(${participant.id})">Профиль</button>
      </div>
    `;
    return `
      <tr>
        <td>${participant.id}</td>
        <td>${participant.name}</td>
        <td>${participant.age}</td>
        <td><span class="badge badge-primary">${roleTitles[participant.role] || "Участник"}</span></td>
        <td>${participant.subscription}</td>
        <td>${participant.remaining === 999 ? "∞" : participant.remaining}</td>
        <td>${statusBadge}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join("");

  if (!data.length) {
    table.innerHTML = `<tr><td colspan="8" class="muted">Ничего не найдено.</td></tr>`;
  }
}

function renderAdminCreateForm() {
  const card = document.getElementById("adminParticipantCreateCard");
  const subscriptionSelect = document.getElementById("newParticipantSubscription");
  if (!card || !subscriptionSelect) return;
  

  card.style.display = state.currentUser?.role === "admin" ? "block" : "none";
  
  if (state.currentUser?.role === "admin") {
    subscriptionSelect.innerHTML = state.subscriptions
      .filter((sub) => sub.accessLevel !== "trial")
      .map((sub) => `<option value="${sub.name}">${sub.name} — ${sub.price}</option>`)
      .join("");
  }
}

function openParticipantModal() {
  if (!state.currentUser || state.currentUser.role !== "admin") return;
  const modal = document.getElementById("participantModal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeParticipantModal() {
  const modal = document.getElementById("participantModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function handleCreateParticipant(e) {
  e.preventDefault();

  if (!state.currentUser || state.currentUser.role !== "admin") {
    alert("Только администратор может добавлять пользователей.");
    return;
  }

  const name = document.getElementById("newParticipantName").value.trim();
  const age = Number(document.getElementById("newParticipantAge").value);
  const phone = document.getElementById("newParticipantPhone").value.trim();
  const email = document.getElementById("newParticipantEmail").value.trim();
  const login = document.getElementById("newParticipantLogin").value.trim();
  const password = document.getElementById("newParticipantPassword").value.trim();
  const role = document.getElementById("newParticipantRole").value;
  const subscriptionName = document.getElementById("newParticipantSubscription").value;

  const subscription = state.subscriptions.find(
    (sub) => sub.name === subscriptionName
  );

  if (!name || !age || !login || !password) {
    alert("Заполните обязательные поля.");
    return;
  }

  const response = await fetch(`${API_URL}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      age,
      phone,
      email,
      login,
      password,
      role,
      subscription_id: subscription?.id || 1,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка добавления пользователя");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  renderParticipantsTable();
  renderDashboard();
  renderResultsModule();

  document.getElementById("createParticipantForm").reset();
  closeParticipantModal();

  alert("Пользователь добавлен.");
}

function renderParticipantProfile(participant) {
  document.getElementById("profileParticipantId").value = participant.id;
  document.getElementById("profileName").value = participant.name || "";
  document.getElementById("profileAge").value = participant.age || "";
  document.getElementById("profilePhone").value = participant.phone || "";
  document.getElementById("profileEmail").value = participant.email || "";
  document.getElementById("profileStatus").value = participant.status || "active";
  document.getElementById("profileNotes").value = participant.notes || "";
  document.getElementById("profileRemaining").value = participant.remaining === 999 ? 999 : participant.remaining;

  const profileSubscription = document.getElementById("profileSubscription");
  profileSubscription.innerHTML = state.subscriptions
    .filter((sub) => sub.accessLevel !== "trial")
    .map((sub) => {
      const selected = sub.name === participant.subscription ? "selected" : "";
      return `<option value="${sub.name}" ${selected}>${sub.name} — ${sub.price}</option>`;
    }).join("");

  const accessBadge = participant.trialOnly
    ? '<span class="badge badge-warning">Только пробное занятие</span>'
    : '<span class="badge badge-success">Полный доступ по абонементу</span>';

  document.getElementById("currentSubscriptionInfo").innerHTML = `
    <h5>Текущий абонемент</h5>
    <p><strong>Название:</strong> ${participant.subscription || "Не назначен"}</p>
    <p><strong>Осталось тренировок:</strong> ${participant.remaining === 999 ? "∞" : participant.remaining}</p>
    <p><strong>Статус:</strong> ${participant.blocked ? '<span class="badge badge-danger">Заблокирован</span>' : '<span class="badge badge-success">Активен</span>'}</p>
    <p><strong>Доступ:</strong> ${accessBadge}</p>
    ${participant.trialOnly ? '<p class="muted">После регистрации участнику доступно только пробное занятие. Остальные абонементы назначает администратор.</p>' : ''}
  `;

  applyProfilePermissions();
}

function applyProfilePermissions() {
  const isAdmin = state.currentUser.role === "admin";

  ["profileName", "profileAge", "profilePhone", "profileEmail", "profileNotes"]
    .forEach((id) => {
      document.getElementById(id).disabled = false;
    });

  ["profileStatus", "profileSubscription", "profileRemaining"]
    .forEach((id) => {
      document.getElementById(id).disabled = !isAdmin;
    });

  document.getElementById("profileStatus").disabled = !isAdmin;
  document.getElementById("subscriptionForm").style.display = isAdmin ? "grid" : "none";
  const submitBtn = document.querySelector('#participantProfileForm button[type="submit"]');
  if (submitBtn) submitBtn.style.display = (isAdmin || state.currentUser.role === "participant") ? "inline-flex" : "none";
}

async function saveParticipantProfile(e) {
  e.preventDefault();

  if (state.currentUser.role !== "admin") {
    alert("Только администратор может редактировать профиль.");
    return;
  }

  const participantId = Number(document.getElementById("profileParticipantId").value);
  const subscriptionName = document.getElementById("profileSubscription").value;

  const subscription = state.subscriptions.find(
    (sub) => sub.name === subscriptionName
  );

  const response = await fetch(`${API_URL}/participants/${participantId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: document.getElementById("profileName").value.trim(),
      age: Number(document.getElementById("profileAge").value),
      phone: document.getElementById("profilePhone").value.trim(),
      email: document.getElementById("profileEmail").value.trim(),
      status: document.getElementById("profileStatus").value,
      notes: document.getElementById("profileNotes").value.trim(),
      subscription_id: subscription?.id || 1,
      remaining: Number(document.getElementById("profileRemaining").value) || 0,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка сохранения профиля");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  const participant = getParticipantById(participantId);

  renderParticipantsTable();
  renderDashboard();

  if (participant) {
    renderParticipantProfile(participant);
  }

  alert("Профиль участника сохранён.");
}

function renderInventoryTable() {
  const table = document.getElementById("inventoryTable");
  if (!table) return;
  if (state.currentUser.role !== "admin") {
    table.innerHTML = `<tr><td colspan="5" class="muted">Инвентарь доступен только администратору.</td></tr>`;
    return;
  }
  table.innerHTML = state.inventory.map((inv) => {
    const statusBadge = inv.status === "available"
      ? '<span class="badge badge-success">На складе</span>'
      : '<span class="badge badge-warning">Выдано</span>';
    const actions = inv.status === "available"
      ? `<button class="btn btn-primary btn-small" onclick="issueInventory(${inv.id})">Выдать</button>`
      : `<button class="btn btn-outline btn-small" onclick="returnInventory(${inv.id})">Вернуть</button>`;
    return `
      <tr>
        <td>${inv.id}</td>
        <td>${inv.item}</td>
        <td>${statusBadge}</td>
        <td>${inv.issuedTo || "-"}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join("");
}

async function issueInventory(id) {
  if (state.currentUser.role !== "admin") return;

  const participantName = prompt("Кому выдать оборудование? Укажите имя участника:");
  if (!participantName) return;

  try {
    await apiRequest(`${API_URL}/inventory/${id}/issue`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_name: participantName.trim() }),
    });

    await loadDataFromServer();
    normalizeData();

    renderInventoryTable();
    renderDashboard();

    alert("Инвентарь выдан.");
  } catch (error) {
    alert(error.message);
  }
}

async function returnInventory(id) {
  if (state.currentUser.role !== "admin") return;

  try {
    await apiRequest(`${API_URL}/inventory/${id}/return`, { method: "PUT" });

    await loadDataFromServer();
    normalizeData();

    renderInventoryTable();
    renderDashboard();

    alert("Инвентарь возвращён.");
  } catch (error) {
    alert(error.message);
  }
}

function getVisibleTrainingsForCurrentUser() {
  if (!state.currentUser) return [];
  if (state.currentUser.role === "trainer") {
    return state.trainings.filter((training) => training.trainer === state.currentUser.name);
  }
  if (state.currentUser.role === "participant") {
    const ownParticipant = getOwnParticipantRecord();
    return state.trainings.filter((training) => canParticipantAccessTraining(ownParticipant, training));
  }
  return state.trainings;
}

function canManageTraining(training) {
  if (!state.currentUser || !training) return false;
  return state.currentUser.role === "admin" || (state.currentUser.role === "trainer" && training.trainer === state.currentUser.name);
}

function renderTrainingModule() {
  const scheduleList = document.getElementById("scheduleList");
  const details = document.getElementById("trainingDayDetails");
  const badge = document.getElementById("selectedTrainingBadge");
  const heading = document.getElementById("scheduleHeading");
  const adminActions = document.getElementById("trainingAdminActions");
  if (!scheduleList || !details || !badge) return;

  if (adminActions) adminActions.style.display = state.currentUser?.role === "admin" ? "flex" : "none";

  const trainings = getVisibleTrainingsForCurrentUser()
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  if (heading) heading.textContent = state.currentUser.role === "trainer" ? "Мои тренировки" : "Расписание тренеров";

  scheduleList.innerHTML = "";

  if (!trainings.length) {
    state.selectedTrainingId = null;
    badge.textContent = "Не выбрано";
    details.innerHTML = `<div class="list-item"><p class="muted">Нет тренировок для отображения.</p></div>`;
    return;
  }

  if (!trainings.some((training) => Number(training.id) === Number(state.selectedTrainingId))) {
    state.selectedTrainingId = trainings[0].id;
  }

  trainings.forEach((training) => {
    const item = document.createElement("article");
    item.className = `list-item training-summary-card ${Number(state.selectedTrainingId) === Number(training.id) ? "selected" : ""}`;
    item.innerHTML = `
      <button type="button" class="training-summary-main" onclick="selectTraining(${training.id})">
        <h5>${training.trainer}</h5>
        <p><strong>Когда:</strong> ${training.date}</p>
        <p><strong>Время:</strong> ${training.time} — ${training.endTime}</p>
        <p><strong>Тренировка:</strong> ${training.title}</p>
        <p><strong>Формат доступа:</strong> ${training.accessLevel === "trial" ? "Пробное занятие" : "По абонементу"}</p>
        <p><strong>Записано:</strong> ${training.participants.length}/${training.slots}</p>
      </button>
      ${state.currentUser.role === "admin" ? `
        <div class="actions mt-16">
          <button type="button" class="btn btn-outline btn-small" onclick="openTrainingModal(${training.id})">Редактировать</button>
          <button type="button" class="btn btn-danger btn-small" onclick="deleteTraining(${training.id})">Удалить</button>
        </div>
      ` : ""}
    `;
    scheduleList.appendChild(item);
  });

  const selectedTraining = getTrainingById(state.selectedTrainingId);
  if (!selectedTraining) return;

  badge.textContent = `${selectedTraining.date} ${selectedTraining.time}`;
  const canManage = canManageTraining(selectedTraining);

  const rows = selectedTraining.participants.map((participantId) => {
    const participant = getParticipantById(Number(participantId));
    if (!participant) return "";
    const confirmed = selectedTraining.confirmed.includes(Number(participantId));
    const attended = selectedTraining.attended.includes(Number(participantId));
    return `
      <tr>
        <td>${participant.name}</td>
        <td>${confirmed ? '<span class="badge badge-success">Подтверждена</span>' : '<span class="badge badge-warning">Не подтверждена</span>'}</td>
        <td>${attended ? '<span class="badge badge-primary">Присутствовал</span>' : '<span class="badge badge-danger">Не отмечен</span>'}</td>
        <td>
          ${canManage ? `
            <div class="actions">
              <button type="button" class="btn btn-secondary btn-small" onclick="confirmTraining(${selectedTraining.id}, ${participant.id})">Подтвердить</button>
              <button type="button" class="btn btn-success btn-small" onclick="markAttendance(${selectedTraining.id}, ${participant.id})">Присутствие</button>
              <button type="button" class="btn btn-danger btn-small" onclick="cancelTrainingBooking(${selectedTraining.id}, ${participant.id})">Отменить</button>
            </div>
          ` : '<span class="muted">Нет действий</span>'}
        </td>
      </tr>
    `;
  }).join("");

  const options = state.participants
    .filter((p) => !p.blocked && !selectedTraining.participants.includes(p.id) && canParticipantAccessTraining(p, selectedTraining))
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");

  details.innerHTML = `
    <div class="list-item">
      <p><strong>Тренер:</strong> ${selectedTraining.trainer}</p>
      <p><strong>Дата:</strong> ${selectedTraining.date}</p>
      <p><strong>Время работы:</strong> ${selectedTraining.time} — ${selectedTraining.endTime}</p>
      <p><strong>Формат доступа:</strong> ${selectedTraining.accessLevel === "trial" ? "Пробное занятие" : "По абонементу"}</p>
      <p><strong>Записано:</strong> ${selectedTraining.participants.length} из ${selectedTraining.slots}</p>
      ${state.currentUser.role === "admin" ? `
        <div class="actions mt-16">
          <button type="button" class="btn btn-outline btn-small" onclick="openTrainingModal(${selectedTraining.id})">Редактировать тренировку</button>
          <button type="button" class="btn btn-danger btn-small" onclick="deleteTraining(${selectedTraining.id})">Удалить тренировку</button>
        </div>
      ` : ""}
    </div>

    <div class="table-card mt-16">
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Участник</th>
              <th>Подтверждение</th>
              <th>Посещение</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" class="muted">На этот день никто не записан.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    ${(state.currentUser.role === "admin" || state.currentUser.role === "participant") ? `
      <div class="card mt-16">
        <h5>${state.currentUser.role === "participant" ? "Записаться на тренировку" : "Добавить участника на этот день"}</h5>
        <div class="inline-form mt-16">
          ${state.currentUser.role === "admin" ? `<select id="participantSelect">${options || '<option value="">Нет доступных участников</option>'}</select>` : ""}
          <button type="button" class="btn btn-primary" onclick="bookTraining(${selectedTraining.id})">Записаться</button>
        </div>
      </div>
    ` : ""}
  `;
}

function selectTraining(trainingId) {
  state.selectedTrainingId = Number(trainingId);
  renderTrainingModule();
}

function openTrainingModal(trainingId = null) {
  if (state.currentUser?.role !== "admin") return;

  editingTrainingId = trainingId;

  const modal = document.getElementById("trainingModal");
  const form = document.getElementById("trainingFormModalForm");
  const title = document.getElementById("trainingModalTitle");
  const trainerSelect = document.getElementById("trainingModalTrainer");

  if (!modal || !form || !trainerSelect) return;

  form.reset();
  trainerSelect.innerHTML = state.trainers
    .map((trainer) => `<option value="${trainer.id}">${trainer.name}</option>`)
    .join("");

  const training = trainingId ? getTrainingById(trainingId) : null;
  if (title) title.textContent = training ? "Редактировать тренировку" : "Добавить тренировку";

  document.getElementById("trainingModalTitleInput").value = training?.title || "";
  document.getElementById("trainingModalDate").value = training?.date || "";
  document.getElementById("trainingModalStart").value = training?.time || "";
  document.getElementById("trainingModalEnd").value = training?.endTime || "";
  document.getElementById("trainingModalTrainer").value = training?.trainerId || state.trainers[0]?.id || "";
  document.getElementById("trainingModalSlots").value = training?.slots || 10;
  document.getElementById("trainingModalAccessLevel").value = training?.accessLevel || "full";
  document.getElementById("trainingModalComment").value = training?.comment || "";

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeTrainingModal() {
  const modal = document.getElementById("trainingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  editingTrainingId = null;
}

async function saveTrainingFromModal(event) {
  event.preventDefault();

  const payload = {
    title: document.getElementById("trainingModalTitleInput").value.trim(),
    training_date: document.getElementById("trainingModalDate").value,
    start_time: document.getElementById("trainingModalStart").value,
    end_time: document.getElementById("trainingModalEnd").value,
    trainer_id: Number(document.getElementById("trainingModalTrainer").value),
    slots: Number(document.getElementById("trainingModalSlots").value),
    accessLevel: document.getElementById("trainingModalAccessLevel").value,
    comment: document.getElementById("trainingModalComment").value.trim(),
  };

  if (!payload.title || !payload.training_date || !payload.start_time || !payload.end_time || !payload.trainer_id) {
    alert("Заполните обязательные поля тренировки.");
    return;
  }

  try {
    const url = editingTrainingId
      ? `${API_URL}/trainings/${editingTrainingId}`
      : `${API_URL}/trainings`;

    await apiRequest(url, {
      method: editingTrainingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await loadDataFromServer();
    normalizeData();
    renderTrainingModule();
    renderDashboard();
    renderResultsModule();
    closeTrainingModal();

    alert(editingTrainingId ? "Тренировка обновлена." : "Тренировка добавлена.");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteTraining(trainingId) {
  if (state.currentUser?.role !== "admin") return;
  if (!confirm("Удалить тренировку? Все записи и результаты по ней также будут удалены.")) return;

  try {
    await apiRequest(`${API_URL}/trainings/${trainingId}`, { method: "DELETE" });

    await loadDataFromServer();
    normalizeData();

    if (Number(state.selectedTrainingId) === Number(trainingId)) {
      state.selectedTrainingId = state.trainings[0]?.id || null;
    }

    renderTrainingModule();
    renderDashboard();
    renderResultsModule();

    alert("Тренировка удалена.");
  } catch (error) {
    alert(error.message);
  }
}

async function bookTraining(trainingId) {
  const training = getTrainingById(Number(trainingId));

  if (!training) {
    alert("Тренировка не найдена.");
    return;
  }

  let participantId;

  if (state.currentUser.role === "participant") {
    const ownParticipant = state.participants.find(
      (participant) => participant.name === state.currentUser.name
    );
    participantId = ownParticipant?.id;
  } else {
    participantId = Number(document.getElementById("participantSelect")?.value);
  }

  const participant = getParticipantById(Number(participantId));

  if (!participant) {
    alert("Выберите участника.");
    return;
  }

  const response = await fetch(`${API_URL}/trainings/${trainingId}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participant.id }),
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка записи на тренировку");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  alert("Участник записан на тренировку.");

  renderTrainingModule();
  renderResultsModule();
}

async function confirmTraining(trainingId, participantId) {
  const response = await fetch(
    `${API_URL}/trainings/${trainingId}/confirm/${participantId}`,
    { method: "PUT" }
  );

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка подтверждения записи");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  alert("Запись подтверждена.");
  renderTrainingModule();
}

async function markAttendance(trainingId, participantId) {
  const response = await fetch(
    `${API_URL}/trainings/${trainingId}/attendance/${participantId}`,
    { method: "PUT" }
  );

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка отметки посещения");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  alert("Посещение отмечено.");

  renderTrainingModule();
  renderParticipantsTable();
  renderDashboard();
}

async function cancelTrainingBooking(trainingId, participantId) {
  const response = await fetch(
    `${API_URL}/trainings/${trainingId}/book/${participantId}`,
    { method: "DELETE" }
  );

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "Ошибка отмены записи");
    return;
  }

  await loadDataFromServer();
  normalizeData();

  alert("Запись отменена.");
  renderTrainingModule();
  renderResultsModule();
}

function getVisibleResultsParticipants() {
  if (!state.currentUser) return [];
  if (state.currentUser.role === "admin") {
    return [...state.participants].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (state.currentUser.role === "trainer") {
    const participantIds = new Set(
      state.trainings
        .filter((training) => training.trainer === state.currentUser.name)
        .flatMap((training) => training.participants),
    );
    return state.participants
      .filter((participant) => participantIds.has(participant.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const own = state.participants.find((participant) => participant.name === state.currentUser.name);
  return own ? [own] : [];
}

function canEditResultForParticipantTraining(participantId, trainingId, allowView = false) {
  const training = getTrainingById(trainingId);
  if (!training) return false;
  if (state.currentUser.role === "admin") return true;
  if (state.currentUser.role === "trainer") {
    return training.trainer === state.currentUser.name && training.participants.includes(participantId);
  }
  if (state.currentUser.role === "participant") {
    const participant = getParticipantById(participantId);
    return allowView && participant?.name === state.currentUser.name;
  }
  return false;
}

function getVisibleResultsForParticipant(participantId) {
  return state.results
    .filter((result) => result.participantId === participantId)
    .filter((result) => canEditResultForParticipantTraining(participantId, result.trainingId, true))
    .sort((a, b) => {
      const trainingA = getTrainingById(a.trainingId);
      const trainingB = getTrainingById(b.trainingId);
      return `${trainingA?.date || ""}`.localeCompare(`${trainingB?.date || ""}`);
    });
}

function getVisibleEditableTrainingsForParticipant(participantId) {
  if (state.currentUser.role === "admin") {
    return state.trainings.filter((training) => training.participants.includes(participantId));
  }
  if (state.currentUser.role === "trainer") {
    return state.trainings.filter((training) => training.trainer === state.currentUser.name && training.participants.includes(participantId));
  }
  return state.trainings.filter((training) => training.participants.includes(participantId) && getParticipantById(participantId)?.name === state.currentUser.name);
}

function renderResultsModule() {
  const resultsList = document.getElementById("resultsList");
  const previewBlock = document.getElementById("statisticsBlock");
  const sideHeading = document.getElementById("selectedPersonResultsHeading");
  const detailCard = document.getElementById("personResultsDetail");
  const trainingsBlock = document.getElementById("personResultsTrainings");
  const detailTitle = document.getElementById("personResultsTitle");
  const searchInput = document.getElementById("resultsSearch");
  const peopleHeading = document.getElementById("resultsPeopleHeading");
  const chartBlock = document.getElementById("resultsChartBlock");
  if (!resultsList || !previewBlock) return;

  const isParticipant = state.currentUser.role === "participant";
  if (searchInput) searchInput.parentElement.style.display = isParticipant ? "none" : "block";

  const visibleParticipants = getVisibleResultsParticipants();
  const searchValue = isParticipant ? "" : String(searchInput?.value || "").trim().toLowerCase();
  const filteredParticipants = visibleParticipants.filter((participant) => participant.name.toLowerCase().includes(searchValue));
  if (peopleHeading) peopleHeading.textContent = state.currentUser.role === "trainer" ? "Мои подопечные" : (isParticipant ? "Мои результаты" : "Участники");

  if (!filteredParticipants.some((participant) => Number(participant.id) === Number(state.selectedResultsParticipantId))) {
    state.selectedResultsParticipantId = filteredParticipants[0]?.id || null;
  }

  resultsList.innerHTML = filteredParticipants.map((participant) => {
    const participantResults = getVisibleResultsForParticipant(participant.id);
    const best = participantResults.length ? Math.max(...participantResults.map((result) => result.score)) : "—";
    const isSelected = Number(state.selectedResultsParticipantId) === Number(participant.id);
    return `
      <div class="list-item results-person-card ${isSelected ? "selected" : ""}" onclick="showPersonResultsDetail(${participant.id})" role="button" tabindex="0">
        <div>
          <h5>${participant.name}</h5>
          <p><strong>Результатов:</strong> ${participantResults.length}</p>
          <p><strong>Лучший результат:</strong> ${best}</p>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><p class="muted">Участники не найдены.</p></div>`;

  if (!state.selectedResultsParticipantId) {
    if (sideHeading) sideHeading.textContent = "Результаты участника";
    previewBlock.innerHTML = `<div class="list-item"><p class="muted">Выберите участника слева, и здесь появятся его результаты.</p></div>`;
    if (chartBlock) chartBlock.innerHTML = "";
    if (detailCard) detailCard.style.display = "none";
    return;
  }

  const participant = getParticipantById(state.selectedResultsParticipantId);
  if (!participant) return;
  const previewResults = getVisibleResultsForParticipant(participant.id);
  if (sideHeading) sideHeading.textContent = `Результаты: ${participant.name}`;
  previewBlock.innerHTML = previewResults.map((result) => {
    const training = getTrainingById(result.trainingId);
    return `
      <div class="list-item">
        <h5>${training?.title || "Тренировка"}</h5>
        <p><strong>Дата:</strong> ${training?.date || "—"}</p>
        <p><strong>Результат:</strong> ${result.score} очков</p>
        ${result.comment ? `<p><strong>Комментарий:</strong> ${result.comment}</p>` : ""}
      </div>
    `;
  }).join("") || `<div class="list-item"><p class="muted">У этого участника пока нет внесённых результатов.</p></div>`;

  if (chartBlock) chartBlock.innerHTML = isParticipant ? buildParticipantResultsChart(previewResults) : "";

  if (detailCard) detailCard.style.display = "block";
  if (detailTitle) detailTitle.textContent = `Карточка участника: ${participant.name}`;

  const visibleTrainings = getVisibleEditableTrainingsForParticipant(participant.id);
  trainingsBlock.innerHTML = visibleTrainings.map((training) => {
    const result = state.results.find((item) => item.participantId === participant.id && item.trainingId === training.id);
    const canEdit = canEditResultForParticipantTraining(participant.id, training.id);
    return `
      <div class="list-item">
        <div class="card-header-inline">
          <div>
            <h5>${training.title}</h5>
            <p><strong>Дата:</strong> ${training.date}</p>
            <p><strong>Результат:</strong> ${result ? `${result.score} очков` : "не внесён"}</p>
            ${result?.comment ? `<p><strong>Комментарий тренера:</strong> ${result.comment}</p>` : ""}
          </div>
          ${canEdit ? `
            <form class="stack-form result-detail-form" onsubmit="saveResultForParticipant(event, ${participant.id}, ${training.id})">
              <input type="number" name="score" class="input result-inline-input" min="0" max="720" value="${result ? result.score : ""}" placeholder="Очки" />
              <textarea name="comment" class="input" rows="3" placeholder="Комментарий тренера">${result?.comment || ""}</textarea>
              <button type="submit" class="btn btn-primary btn-small">Сохранить</button>
            </form>
          ` : '<span class="muted">Нет доступа</span>'}
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><p class="muted">Нет доступных тренировок для редактирования.</p></div>`;
}

function saveResult(e) {
  e.preventDefault();
}

function showPersonResultsDetail(participantId) {
  state.selectedResultsParticipantId = Number(participantId);
  renderResultsModule();
}

function hidePersonResultsDetail() {
  state.selectedResultsParticipantId = null;
  renderResultsModule();
}

async function saveResultForParticipant(event, participantId, trainingId) {
  event.preventDefault();

  if (!canEditResultForParticipantTraining(participantId, trainingId)) {
    alert("Недостаточно прав для изменения результата.");
    return;
  }

  const scoreInput = event.currentTarget.querySelector('input[name="score"]');
  const commentInput = event.currentTarget.querySelector('textarea[name="comment"]');
  const score = Number(scoreInput?.value);

  if (Number.isNaN(score)) {
    alert("Введите корректный результат.");
    return;
  }

  try {
    await apiRequest(`${API_URL}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: participantId,
        training_id: trainingId,
        score,
        comment: commentInput?.value.trim() || "",
      }),
    });

    await loadDataFromServer();
    normalizeData();

    renderResultsModule();
    renderDashboard();

    alert("Результат сохранён.");
  } catch (error) {
    alert(error.message);
  }
}

function buildParticipantResultsChart(results) {
  if (!results.length) {
    return `<div class="list-item mt-16"><p class="muted">График появится, когда будут внесены результаты.</p></div>`;
  }
  const pointsData = results
    .map((result) => ({ result, training: getTrainingById(result.trainingId) }))
    .filter((item) => item.training)
    .sort((a, b) => `${a.training.date}`.localeCompare(`${b.training.date}`));
  const maxScore = Math.max(...pointsData.map((item) => item.result.score), 1);
  const width = 420;
  const height = 180;
  const padding = 24;
  const step = pointsData.length > 1 ? (width - padding * 2) / (pointsData.length - 1) : 0;
  const points = pointsData.map((item, index) => {
    const x = padding + index * step;
    const y = height - padding - ((item.result.score / maxScore) * (height - padding * 2));
    return { x, y, label: item.training.date, score: item.result.score };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  return `
    <div class="results-chart-card mt-16">
      <h5>График результатов</h5>
      <svg viewBox="0 0 ${width} ${height}" class="results-chart" aria-label="График результатов">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis" />
        <polyline points="${polyline}" class="chart-line" />
        ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="chart-point"></circle><text x="${point.x}" y="${point.y - 10}" class="chart-value" text-anchor="middle">${point.score}</text>`).join("")}
        ${points.map((point) => `<text x="${point.x}" y="${height - 6}" class="chart-label" text-anchor="middle">${point.label.slice(5)}</text>`).join("")}
      </svg>
    </div>
  `;
}

function getOwnParticipantRecord() {
  if (!state.currentUser) return null;
  return state.participants.find((participant) => participant.name === state.currentUser.name) || null;
}

function canParticipantAccessTraining(participant, training) {
  if (!participant || !training) return false;
  if (participant.blocked) return false;
  
  if (training.accessLevel === "trial") {
    return participant.remaining > 0;
  }
  
  if (participant.trialOnly) {
    return false;
  }
  
  return participant.remaining > 0 || participant.remaining === 999;
}

function renderSubscriptionsInfo() {
  const container = document.getElementById("subscriptionsInfoContent");
  const adminActions = document.getElementById("subscriptionsAdminActions");
  if (!container) return;

  if (adminActions) {
    adminActions.style.display = state.currentUser?.role === "admin" ? "flex" : "none";
  }

  const subscriptionsHtml = state.subscriptions.map((sub) => `
    <article class="card subscription-card">
      <div class="card-header-inline">
        <div>
          <h4>${sub.name}</h4>
          <p class="muted">${sub.accessLevel === "trial" ? "Пробный доступ" : "Полный доступ"}</p>
        </div>
        ${state.currentUser?.role === "admin" ? `
          <div class="actions">
            <button type="button" class="btn btn-outline btn-small" onclick="openSubscriptionModal(${sub.id})">Редактировать</button>
            <button type="button" class="btn btn-danger btn-small" onclick="deleteSubscription(${sub.id})">Удалить</button>
          </div>
        ` : ""}
      </div>
      <p><strong>Стоимость:</strong> ${sub.price}</p>
      <p><strong>Количество тренировок:</strong> ${Number(sub.visits) === 999 ? "Безлимит" : Number(sub.visits) || 0}</p>
      <p>${sub.description || "Описание отсутствует"}</p>
    </article>
  `).join("");

  const servicesHtml = Array.isArray(state.servicesCatalog) && state.servicesCatalog.length
    ? `
      <div class="subscriptions-static-services">
        <h4>Дополнительные услуги клуба</h4>
        ${state.servicesCatalog.map((group) => `
          <article class="card subscriptions-category-card">
            <h4>${group.category}</h4>
            <div class="subscriptions-items-list">
              ${group.items.map((item) => `
                <div class="list-item">
                  <h5>${item.title}</h5>
                  ${item.details.map((detail) => `<p>${detail}</p>`).join("")}
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="subscriptions-info-grid">
      ${subscriptionsHtml || '<div class="list-item"><p class="muted">Абонементы пока не добавлены.</p></div>'}
    </div>
    ${servicesHtml}
  `;
}

function openSubscriptionModal(subscriptionId = null) {
  if (state.currentUser?.role !== "admin") return;

  editingSubscriptionId = subscriptionId;
  const modal = document.getElementById("subscriptionModal");
  const title = document.getElementById("subscriptionModalTitle");
  const form = document.getElementById("subscriptionFormModalForm");

  if (!modal || !form) return;

  form.reset();

  const subscription = subscriptionId
    ? state.subscriptions.find((item) => Number(item.id) === Number(subscriptionId))
    : null;

  if (title) title.textContent = subscription ? "Редактировать абонемент" : "Добавить абонемент";

  document.getElementById("subscriptionModalName").value = subscription?.name || "";
  document.getElementById("subscriptionModalPrice").value = subscription?.price || "";
  document.getElementById("subscriptionModalVisits").value = subscription?.visits ?? 1;
  document.getElementById("subscriptionModalAccessLevel").value = subscription?.accessLevel || "full";
  document.getElementById("subscriptionModalDescription").value = subscription?.description || "";

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeSubscriptionModal() {
  const modal = document.getElementById("subscriptionModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  editingSubscriptionId = null;
}

async function saveSubscriptionFromModal(event) {
  event.preventDefault();

  const payload = {
    name: document.getElementById("subscriptionModalName").value.trim(),
    price: document.getElementById("subscriptionModalPrice").value.trim(),
    visits: Number(document.getElementById("subscriptionModalVisits").value),
    accessLevel: document.getElementById("subscriptionModalAccessLevel").value,
    description: document.getElementById("subscriptionModalDescription").value.trim(),
  };

  if (!payload.name || !payload.price || Number.isNaN(payload.visits)) {
    alert("Заполните название, стоимость и количество тренировок.");
    return;
  }

  try {
    const url = editingSubscriptionId
      ? `${API_URL}/subscriptions/${editingSubscriptionId}`
      : `${API_URL}/subscriptions`;

    await apiRequest(url, {
      method: editingSubscriptionId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await loadDataFromServer();
    normalizeData();
    renderSubscriptionsInfo();
    renderAdminCreateForm();
    renderDashboard();
    closeSubscriptionModal();

    alert(editingSubscriptionId ? "Абонемент обновлён." : "Абонемент добавлен.");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSubscription(subscriptionId) {
  if (state.currentUser?.role !== "admin") return;
  if (!confirm("Удалить этот абонемент?")) return;

  try {
    await apiRequest(`${API_URL}/subscriptions/${subscriptionId}`, { method: "DELETE" });
    await loadDataFromServer();
    normalizeData();
    renderSubscriptionsInfo();
    renderAdminCreateForm();
    renderDashboard();
    alert("Абонемент удалён.");
  } catch (error) {
    alert(error.message);
  }
}

function getParticipantById(id) {
  return state.participants.find((participant) => participant.id === Number(id));
}

function getTrainingById(id) {
  return state.trainings.find((training) => training.id === Number(id));
}

function viewProfile(id) {
  const participant = getParticipantById(id);
  if (!participant) return;
  const isAdmin = state.currentUser.role === "admin";
  const isOwnProfile = state.currentUser.role === "participant" && state.currentUser.name === participant.name;
  if (!isAdmin && !isOwnProfile) {
    alert("Недостаточно прав для просмотра профиля.");
    return;
  }
  renderParticipantProfile(participant);
  showSection("participantProfile");
}