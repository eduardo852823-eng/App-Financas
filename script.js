/* ============================================================
   FinanApp — front-end
   Agora conectado a um backend real (Node + Express + SQLite).
   Só o token de login fica no localStorage; todo o resto (perfil,
   saldo, bancos, transações, preferências) vive no banco de dados.
   ============================================================ */

const API_BASE = window.FINANHUB_API_BASE || "http://localhost:3001/api";
const GOOGLE_CLIENT_ID = "732987980412-3caubvvgvknj05hpl5mb5p2lcfs3b3pm.apps.googleusercontent.com";
const TOKEN_KEY = "fh_token";

const CATEGORIES = [
  { id: "alimentacao", name: "Alimentação", color: "#F59E0B", icon: "🍔" },
  { id: "transporte", name: "Transporte", color: "#3B82F6", icon: "🚗" },
  { id: "contas", name: "Contas", color: "#6366F1", icon: "💡" },
  { id: "entretenimento", name: "Entretenimento", color: "#A855F7", icon: "🎬" },
  { id: "compras", name: "Compras", color: "#EC4899", icon: "🛍️" },
  { id: "saude", name: "Saúde", color: "#EF4444", icon: "❤️" },
  { id: "educacao", name: "Educação", color: "#14B8A6", icon: "🎓" },
  { id: "outros", name: "Outros", color: "#9CA3AF", icon: "📦" },
  { id: "salario", name: "Salário", color: "#16A34A", icon: "💰" },
  { id: "nao_identificada", name: "Não identificada", color: "#CBD5E1", icon: "❓" }
];
function catInfo(id) { return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]; }
function fmtBRL(v) {
  const sign = v < 0 ? "-" : "";
  return sign + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function initials(name) { return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ============================================================
   CAMADA DE API
   ============================================================ */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* sem corpo */ }
  if (!res.ok) throw new Error((data && data.error) || "Erro de conexão com o servidor");
  return data;
}

const auth = {
  register: (name, email, password) => api("/auth/register", { method: "POST", body: { name, email, password } }),
  login: (email, password) => api("/auth/login", { method: "POST", body: { email, password } }),
  google: (credential) => api("/auth/google", { method: "POST", body: { credential } })
};

/* ============================================================
   ESTADO EM MEMÓRIA (preenchido a partir da API)
   ============================================================ */
const state = {
  user: null,
  preferences: { theme: "light", currency: "BRL" },
  institutions: [],
  transactions: [],
  pluggyItems: []
};

async function refreshMe() {
  const { user, preferences } = await api("/me");
  state.user = user;
  state.preferences = preferences;
  return user;
}
async function refreshInstitutions() { state.institutions = await api("/institutions"); }
async function refreshTransactions() { state.transactions = await api("/transactions"); }
async function refreshPluggyItems() {
  try { state.pluggyItems = await api("/pluggy/items"); }
  catch (e) { state.pluggyItems = []; }
}
async function refreshAll() {
  await Promise.all([refreshMe(), refreshInstitutions(), refreshTransactions(), refreshPluggyItems()]);
}

const PLUGGY_COLOR_PALETTE = ["#2563EB", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#DB2777"];
function pluggyColorFor(itemId) {
  let hash = 0;
  for (let i = 0; i < itemId.length; i++) hash = (hash * 31 + itemId.charCodeAt(i)) >>> 0;
  return PLUGGY_COLOR_PALETTE[hash % PLUGGY_COLOR_PALETTE.length];
}
function isPluggyBank(bankId) {
  return state.pluggyItems.some(p => p.item_id === bankId);
}
function instInfo(id) {
  const demo = state.institutions.find(i => i.id === id);
  if (demo) return demo;
  const pluggy = state.pluggyItems.find(p => p.item_id === id);
  if (pluggy) return { id, name: pluggy.institution_name || "Conta conectada", color: pluggyColorFor(id), connected: true };
  return { name: id, color: "#94A3B8" };
}
function effectiveCategory(t) { return t.category; }

/* ============================================================
   APP STATE (filtros de tela)
   ============================================================ */
let currentScreen = "inicio";
let dashFilterPeriodo = "all";
let dashFilterBanco = "all";
let txSearch = "";
let txFilterBanco = "all";
let txFilterTipo = "all";
let txFilterCategoria = "all";
let catSegment = "gastos";
let relSegment = "geral";
let pendingCatTxId = null;
let pendingCatSelected = null;
const TX_PAGE_SIZE = 10;
let txVisibleCount = TX_PAGE_SIZE;

/* ============================================================
   TEMA (claro/escuro) — preferência salva no backend, cacheada
   localmente só para aplicar sem "flash" ao abrir o app.
   ============================================================ */
const THEME_CACHE_KEY = "fh_theme_cache";
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const sun = document.getElementById("theme-icon-sun");
  const moon = document.getElementById("theme-icon-moon");
  if (sun && moon) {
    sun.classList.toggle("hidden", theme === "dark");
    moon.classList.toggle("hidden", theme !== "dark");
  }
}
function initTheme() {
  applyTheme(localStorage.getItem(THEME_CACHE_KEY) || "light");
}
async function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_CACHE_KEY, next);
  if (state.user) {
    try { await api("/me/preferences", { method: "PUT", body: { theme: next, currency: state.preferences.currency } }); }
    catch (e) { console.warn("não foi possível salvar a preferência de tema", e); }
  }
  if (currentScreen === "inicio" || currentScreen === "relatorios") renderScreen(currentScreen);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function showLogin() {
  document.getElementById("screen-login").classList.add("active");
  document.getElementById("main-app").classList.remove("active");
}
function showApp() {
  document.getElementById("screen-login").classList.remove("active");
  document.getElementById("main-app").classList.add("active");
  navigateTo("inicio");
}
function navigateTo(screen) {
  if (screen === "transacoes" && currentScreen !== "transacoes") txVisibleCount = TX_PAGE_SIZE;
  currentScreen = screen;
  document.querySelectorAll(".content .screen").forEach(s => s.classList.remove("active"));
  const target = document.querySelector(`.screen[data-screen="${screen}"]`);
  if (target) {
    void target.offsetWidth;
    target.classList.add("active");
  }
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === screen));
  const titles = { inicio: "Início", bancos: "Minhas instituições", transacoes: "Transações", categorias: "Categorias", relatorios: "Relatórios" };
  document.getElementById("topbar-title").textContent = titles[screen] || "";
  renderScreen(screen);
  document.getElementById("content").scrollTop = 0;
}
function renderScreen(screen) {
  if (screen === "inicio") renderDashboard();
  if (screen === "bancos") renderBancos();
  if (screen === "transacoes") renderTransacoes();
  if (screen === "categorias") renderCategorias();
  if (screen === "relatorios") renderRelatorios();
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */
function getAvailableMonths() {
  const set = new Set(state.transactions.map(t => t.date.slice(0,7)));
  return Array.from(set).sort().reverse();
}
function filterTx(txs, { periodo, banco, tipo, categoria, search } = {}) {
  return txs.filter(t => {
    if (periodo && periodo !== "all" && t.date.slice(0,7) !== periodo) return false;
    if (banco && banco !== "all" && t.bank_id !== banco) return false;
    if (tipo && tipo !== "all" && t.type !== tipo) return false;
    if (categoria && categoria !== "all" && effectiveCategory(t) !== categoria) return false;
    if (search && !t.desc.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function populateDashboardFilters() {
  const months = getAvailableMonths();
  const periodoSel = document.getElementById("filter-periodo");
  periodoSel.innerHTML = `<option value="all">Todos os períodos</option>` +
    months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  periodoSel.value = dashFilterPeriodo;

  const bancoSel = document.getElementById("filter-banco");
  const institutions = state.institutions.filter(i => i.connected);
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    institutions.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
  bancoSel.value = dashFilterBanco;
}
function monthLabel(ym) {
  const [y,m] = ym.split("-");
  return `${MONTH_NAMES[parseInt(m)-1]} ${y}`;
}

function renderDashboard() {
  populateDashboardFilters();
  const txs = filterTx(state.transactions, { periodo: dashFilterPeriodo, banco: dashFilterBanco });
  const entradas = txs.filter(t => t.type === "entrada").reduce((s,t) => s + t.value, 0);
  const saidas = txs.filter(t => t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);
  const saldo = entradas - saidas;

  document.getElementById("balance-total").textContent = fmtBRL(saldo);
  document.getElementById("total-entradas").textContent = fmtBRL(entradas);
  document.getElementById("total-saidas").textContent = fmtBRL(saidas);
  document.getElementById("balance-change").textContent = txs.length ? `${txs.length} transações no período` : "Nenhuma transação no período";

  const allTx = state.transactions;
  const banksScroll = document.getElementById("banks-scroll");
  const bankIdsWithTx = [...new Set(allTx.map(t => t.bank_id))];
  const banksToShow = bankIdsWithTx
    .map(id => instInfo(id))
    .filter(i => i && i.name);
  banksScroll.innerHTML = banksToShow.map(i => {
    const bal = allTx.filter(t => t.bank_id === i.id).reduce((s,t) => s + t.value, 0);
    return `<div class="bank-chip">
      <div class="bank-icon" style="background:${i.color}">${initials(i.name)}</div>
      <div class="bank-amount">${fmtBRL(bal)}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${i.name}</div>
    </div>`;
  }).join("") || `<div class="empty-state">Nenhum banco conectado ainda.</div>`;

  const saidasTx = txs.filter(t => t.type === "saida");
  const byCat = {};
  saidasTx.forEach(t => {
    const c = effectiveCategory(t);
    byCat[c] = (byCat[c] || 0) + Math.abs(t.value);
  });
  drawDonut("donut-chart", byCat, saidas);
  renderLegend("donut-legend", byCat, saidas);
}

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
function drawDonut(canvasId, byCat, total) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, rOuter = Math.min(w,h)/2 - 6, rInner = rOuter * 0.62;
  const holeColor = themeColor("--card-bg") || "#FFFFFF";
  const textMain = themeColor("--text-main") || "#14213D";
  const textSecondary = themeColor("--text-secondary") || "#6B7A90";
  const emptyBg = themeColor("--gray-100") || "#EEF2F8";
  if (!total || Object.keys(byCat).length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI*2);
    ctx.fillStyle = emptyBg;
    ctx.fill();
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = textSecondary;
    ctx.textAlign = "center";
    ctx.fillText("Sem dados", cx, cy+4);
    return;
  }
  let start = -Math.PI/2;
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  entries.forEach(([cat, val]) => {
    const angle = (val/total) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, start, start+angle);
    ctx.closePath();
    ctx.fillStyle = catInfo(cat).color;
    ctx.fill();
    start += angle;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI*2);
  ctx.fillStyle = holeColor;
  ctx.fill();
  ctx.font = "700 15px Inter, sans-serif";
  ctx.fillStyle = textMain;
  ctx.textAlign = "center";
  ctx.fillText(fmtBRL(total), cx, cy+2);
  ctx.font = "600 11px Inter, sans-serif";
  ctx.fillStyle = textSecondary;
  ctx.fillText("gastos", cx, cy+18);
}

function renderLegend(elId, byCat, total) {
  const el = document.getElementById(elId);
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  if (!entries.length) { el.innerHTML = `<div class="empty-state">Nenhum gasto no período.</div>`; return; }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? ((val/total)*100).toFixed(1) : "0.0";
    return `<div class="legend-row">
      <div class="legend-left"><span class="legend-dot" style="background:${info.color}"></span>${info.icon} ${info.name}</div>
      <div><span class="legend-pct">${pct}%</span> &nbsp; ${fmtBRL(val)}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   BANCOS
   ============================================================ */
function renderBancos() {
  renderPluggyItems();
  const el = document.getElementById("banks-list");
  el.innerHTML = state.institutions.map(i => `
    <div class="bank-row">
      <div class="bank-row-left">
        <div class="bank-avatar" style="background:${i.color}">${initials(i.name)}</div>
        <div>
          <div class="bank-row-name">${i.name}</div>
          <div class="bank-status ${i.connected ? "connected" : "disconnected"}">
            <span class="dot-status"></span>${i.connected ? "Conectado" : "Não conectado"}
          </div>
        </div>
      </div>
      <button class="btn-connect ${i.connected ? "connected" : ""}" data-toggle-bank="${i.id}">
        ${i.connected ? "Desconectar" : "Conectar"}
      </button>
    </div>
  `).join("");
}

async function toggleBankConnection(id) {
  const modoTeste = document.getElementById("chk-modo-teste")?.checked || false;
  await api(`/institutions/${id}/toggle`, { method: "POST", body: { modoTeste } });
  await Promise.all([refreshInstitutions(), refreshTransactions()]);
  renderBancos();
  if (document.getElementById("modal-add-inst").classList.contains("active")) openAddInstModal();
  if (currentScreen === "inicio") renderDashboard();
}

function openAddInstModal() {
  const el = document.getElementById("add-inst-list");
  el.innerHTML = state.institutions.map(i => `
    <div class="add-inst-item">
      <div class="bank-row-left">
        <div class="bank-avatar" style="background:${i.color}">${initials(i.name)}</div>
        <span style="font-weight:600;font-size:14px">${i.name}</span>
      </div>
      <button class="btn-connect ${i.connected ? "connected" : ""}" data-toggle-bank="${i.id}">
        ${i.connected ? "Conectado" : "Conectar"}
      </button>
    </div>
  `).join("");
  openModal("modal-add-inst");
}

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
function populateTxFilters() {
  const bancoSel = document.getElementById("tx-filter-banco");
  const connected = state.institutions.filter(i => i.connected);
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    connected.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
  bancoSel.value = txFilterBanco;
  document.getElementById("tx-filter-tipo").value = txFilterTipo;

  const catSel = document.getElementById("tx-filter-categoria");
  catSel.innerHTML = `<option value="all">Todas categorias</option>` +
    CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
  catSel.value = txFilterCategoria;
}

function renderTransacoes() {
  populateTxFilters();
  const allTxs = filterTx(state.transactions, { banco: txFilterBanco, tipo: txFilterTipo, categoria: txFilterCategoria, search: txSearch })
    .sort((a,b) => b.date.localeCompare(a.date));
  const container = document.getElementById("tx-list-container");
  if (!allTxs.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma transação encontrada.</div>`;
    return;
  }
  const txs = allTxs.slice(0, txVisibleCount);
  const groups = {};
  txs.forEach(t => {
    const key = t.date.slice(0,7);
    (groups[key] = groups[key] || []).push(t);
  });
  const months = Object.keys(groups).sort().reverse();
  let html = months.map(m => {
    const rows = groups[m].map(t => txRowHtml(t)).join("");
    return `<div class="tx-month-label">${monthLabel(m)}</div>${rows}`;
  }).join("");
  html += `<div class="tx-count-label">Mostrando ${txs.length} de ${allTxs.length} transações</div>`;
  if (allTxs.length > txVisibleCount) {
    html += `<button class="btn btn-outline" id="btn-load-more-tx">Carregar mais</button>`;
  }
  container.innerHTML = html;
}

function txRowHtml(t) {
  const info = instInfo(t.bank_id);
  const cat = catInfo(effectiveCategory(t));
  const isPos = t.value >= 0;
  return `<div class="tx-row" data-tx-id="${t.id}">
    <div class="tx-row-left">
      <div class="tx-icon" style="background:${info.color}">${initials(t.desc.split(" ")[0])}</div>
      <div>
        <div class="tx-desc">${t.desc}</div>
        <div class="tx-meta">
          <span>${info.name} • ${isPos ? "Entrada" : "Saída"}</span>
          <span class="tx-cat-chip">${cat.icon} ${cat.name}</span>
        </div>
      </div>
    </div>
    <div class="tx-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
  </div>`;
}

function openTxDetalhe(id) {
  const t = state.transactions.find(x => x.id === Number(id));
  if (!t) return;
  const info = instInfo(t.bank_id);
  const cat = catInfo(effectiveCategory(t));
  const isPos = t.value >= 0;
  const dateFmt = t.date.split("-").reverse().join("/");
  document.getElementById("detalhe-body").innerHTML = `
    <div class="detalhe-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
    <div style="font-weight:700;font-size:15px">${t.desc}</div>
    <div class="detalhe-cat-badge">${cat.icon} ${cat.name}</div>
    <div class="detalhe-info-row"><span>Banco</span><span>${info.name}</span></div>
    <div class="detalhe-info-row"><span>Data</span><span>${dateFmt}</span></div>
    <div class="detalhe-info-row"><span>Tipo</span><span>${isPos ? "Entrada" : "Saída"}</span></div>
    <div class="detalhe-info-row"><span>Origem</span><span>${isPluggyBank(t.bank_id) ? "Open Finance (real)" : "Demonstração"}</span></div>
    <div class="detalhe-info-row"><span>ID da transação</span><span>#${t.id}</span></div>
    <button class="btn btn-primary" id="btn-alterar-categoria" data-tx-id="${t.id}">Alterar categoria</button>
    <button class="btn btn-danger" id="btn-excluir-tx" data-tx-id="${t.id}">Excluir</button>
  `;
  openModal("modal-detalhe");
}

async function deleteTx(id) {
  await api(`/transactions/${id}`, { method: "DELETE" });
  await refreshTransactions();
  closeAllModals();
  renderScreen(currentScreen);
}

function openCategoriaModal(txId) {
  pendingCatTxId = txId;
  const t = state.transactions.find(x => x.id === Number(txId));
  pendingCatSelected = t ? effectiveCategory(t) : null;
  const grid = document.getElementById("cat-grid");
  grid.innerHTML = CATEGORIES.filter(c => c.id !== "salario").map(c => `
    <div class="cat-grid-item ${c.id === pendingCatSelected ? "selected" : ""}" data-cat-id="${c.id}">
      <div class="cat-icon" style="background:${c.color}">${c.icon}</div>
      ${c.name}
    </div>
  `).join("");
  openModal("modal-categoria");
}
async function saveCategoria() {
  if (pendingCatTxId == null || !pendingCatSelected) return;
  await api(`/transactions/${pendingCatTxId}/category`, { method: "PUT", body: { category: pendingCatSelected } });
  await refreshTransactions();
  closeAllModals();
  renderScreen(currentScreen);
}

/* ============================================================
   CATEGORIAS
   ============================================================ */
function renderCategorias() {
  const txs = state.transactions.filter(t => catSegment === "gastos" ? t.type === "saida" : t.type === "entrada");
  const total = txs.reduce((s,t) => s + Math.abs(t.value), 0);
  const byCat = {};
  txs.forEach(t => {
    const c = effectiveCategory(t);
    byCat[c] = (byCat[c] || 0) + Math.abs(t.value);
  });
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const el = document.getElementById("categorias-list");
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">Nenhuma transação nesta categoria.</div>`;
    return;
  }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? ((val/total)*100).toFixed(1) : "0.0";
    return `<div class="cat-row">
      <div class="cat-row-left">
        <div class="cat-icon" style="background:${info.color}">${info.icon}</div>
        <div>
          <div class="cat-name">${info.name}</div>
          <div class="cat-pct">${pct}%</div>
        </div>
      </div>
      <div class="cat-amount">${fmtBRL(val)}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   RELATÓRIOS
   ============================================================ */
function populateRelatorioFilters() {
  const months = getAvailableMonths();
  const years = Array.from(new Set(months.map(m => m.slice(0,4)))).sort().reverse();
  const anoSel = document.getElementById("rel-ano");
  const currentAno = anoSel.value || years[0] || String(new Date().getFullYear());
  anoSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("") || `<option value="${currentAno}">${currentAno}</option>`;
  anoSel.value = currentAno;

  const mesSel = document.getElementById("rel-mes");
  mesSel.innerHTML = `<option value="all">Todos os meses</option>` + MONTH_NAMES.map((m,i) => `<option value="${i}">${m}</option>`).join("");

  const bancoSel = document.getElementById("rel-banco");
  const connected = state.institutions.filter(i => i.connected);
  bancoSel.innerHTML = `<option value="all">Todos</option>` + connected.map(i => `<option value="${i.id}">${i.name}</option>`).join("");

  const catSel = document.getElementById("rel-categoria");
  catSel.innerHTML = `<option value="all">Todas</option>` + CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

  const comp1 = document.getElementById("comp-mes1"), comp2 = document.getElementById("comp-mes2");
  const opts = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  comp1.innerHTML = opts; comp2.innerHTML = opts;
  if (months.length > 1) { comp1.value = months[1]; comp2.value = months[0]; }
}

function relFilteredTx() {
  const ano = document.getElementById("rel-ano").value;
  const mes = document.getElementById("rel-mes").value;
  const banco = document.getElementById("rel-banco").value;
  const categoria = document.getElementById("rel-categoria").value;
  return state.transactions.filter(t => {
    if (ano && !t.date.startsWith(ano)) return false;
    if (mes !== "all" && parseInt(t.date.slice(5,7))-1 !== parseInt(mes)) return false;
    if (banco !== "all" && t.bank_id !== banco) return false;
    if (categoria !== "all" && effectiveCategory(t) !== categoria) return false;
    return true;
  });
}

function renderRelatorios() {
  populateRelatorioFilters();
  computeRelGeral();
}

function computeRelGeral() {
  const txs = relFilteredTx();
  const entradas = txs.filter(t => t.type === "entrada").reduce((s,t) => s + t.value, 0);
  const saidas = txs.filter(t => t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);
  document.getElementById("rel-entradas").textContent = fmtBRL(entradas);
  document.getElementById("rel-saidas").textContent = fmtBRL(saidas);
  document.getElementById("rel-resultado").textContent = (entradas-saidas >= 0 ? "+ " : "- ") + fmtBRL(Math.abs(entradas-saidas));

  const ano = document.getElementById("rel-ano").value;
  const allTx = state.transactions.filter(t => t.date.startsWith(ano));
  const byMonth = {};
  for (let m=0; m<12; m++) byMonth[m] = { entrada:0, saida:0 };
  allTx.forEach(t => {
    const m = parseInt(t.date.slice(5,7))-1;
    if (t.type === "entrada") byMonth[m].entrada += t.value; else byMonth[m].saida += Math.abs(t.value);
  });
  const connected = [...new Set(txs.map(t => t.bank_id))].map(id => instInfo(id)).filter(i => i && i.name);
  const el = document.getElementById("rel-por-banco");
  el.innerHTML = connected.map(i => {
    const val = txs.filter(t => t.bank_id === i.id && t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);
    return `<div class="bank-line-row"><span>${i.name}</span><span>${fmtBRL(val)}</span></div>`;
  }).join("") || `<div class="empty-state">Nenhum banco conectado.</div>`;
}

function drawBarChart(canvasId, byMonth) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const months = Object.keys(byMonth).map(Number);
  const maxVal = Math.max(1, ...months.flatMap(m => [byMonth[m].entrada, byMonth[m].saida]));
  const padding = 24;
  const groupW = (w - padding) / 12;
  const textSecondary = themeColor("--text-secondary") || "#6B7A90";
  const greenColor = themeColor("--green") || "#16A34A";
  const redColor = themeColor("--red") || "#E5484D";
  ctx.font = "600 9px Inter, sans-serif";
  ctx.fillStyle = textSecondary;
  ctx.textAlign = "center";
  months.forEach(m => {
    const x = padding + m*groupW;
    const barW = groupW/2 - 4;
    const eH = (byMonth[m].entrada/maxVal) * (h - 44);
    const sH = (byMonth[m].saida/maxVal) * (h - 44);
    ctx.fillStyle = greenColor;
    ctx.fillRect(x+2, h-20-eH, barW, eH);
    ctx.fillStyle = redColor;
    ctx.fillRect(x+2+barW+2, h-20-sH, barW, sH);
    ctx.fillStyle = textSecondary;
    ctx.fillText(MONTH_NAMES[m].slice(0,3), x+groupW/2, h-6);
  });
}

function renderComparacao() {
  const m1 = document.getElementById("comp-mes1").value;
  const m2 = document.getElementById("comp-mes2").value;
  const tipo = document.getElementById("comp-tipo").value;
  const txs = state.transactions;
  const v1 = txs.filter(t => t.date.slice(0,7) === m1 && t.type === tipo).reduce((s,t) => s + Math.abs(t.value), 0);
  const v2 = txs.filter(t => t.date.slice(0,7) === m2 && t.type === tipo).reduce((s,t) => s + Math.abs(t.value), 0);
  const diff = v2 - v1;
  const pct = v1 ? ((diff/v1)*100).toFixed(0) : "0";
  const el = document.getElementById("comp-resultado");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="comp-line"><span>${monthLabel(m1)}</span><span>${fmtBRL(v1)}</span></div>
    <div class="comp-line"><span>${monthLabel(m2)}</span><span>${fmtBRL(v2)}</span></div>
    <div class="comp-diff ${diff>=0 ? "up":"down"}">${diff>=0?"↑":"↓"} ${Math.abs(pct)}% <span style="font-weight:500;font-size:13px;color:var(--text-secondary)">(${fmtBRL(Math.abs(diff))} ${diff>=0?"a mais":"a menos"})</span></div>
  `;
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(id) { document.getElementById(id).classList.add("active"); }
function closeAllModals() { document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active")); }

/* ============================================================
   AUTH
   ============================================================ */
function applyUserToUI(user) {
  document.getElementById("greeting-text").textContent = `Olá, ${user.name.split(" ")[0]}!`;
  const img = document.getElementById("avatar-img");
  const icon = document.getElementById("avatar-icon");
  const perfilImg = document.getElementById("perfil-avatar");
  const perfilIcon = document.getElementById("perfil-avatar-icon");
  document.getElementById("perfil-nome").textContent = user.name;
  document.getElementById("perfil-email").textContent = user.email;
  if (user.avatar) {
    img.src = user.avatar; img.classList.remove("hidden"); icon.classList.add("hidden");
    perfilImg.src = user.avatar; perfilImg.classList.remove("hidden"); perfilIcon.classList.add("hidden");
  } else {
    img.classList.add("hidden"); icon.classList.remove("hidden");
    perfilImg.classList.add("hidden"); perfilIcon.classList.remove("hidden");
  }
}

async function afterLoginSuccess(token) {
  setToken(token);
  await refreshAll();
  applyTheme(state.preferences.theme || "light");
  localStorage.setItem(THEME_CACHE_KEY, state.preferences.theme || "light");
  applyUserToUI(state.user);
  showApp();
}

async function logoutUser() {
  clearToken();
  closeAllModals();
  showLogin();
}

let authMode = "login";
function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}
function setAuthMode(mode) {
  authMode = mode;
  document.getElementById("modal-email-title").textContent = mode === "register" ? "Criar conta" : "Entrar com e-mail";
  document.getElementById("field-name-wrap").classList.toggle("hidden", mode !== "register");
  document.getElementById("btn-do-email-login").textContent = mode === "register" ? "Criar conta" : "Entrar";
  clearAuthError();
}

function handleGoogleCredential(response) {
  auth.google(response.credential)
    .then(({ token }) => afterLoginSuccess(token))
    .catch(err => showAuthError(err.message));
}
function initGoogleLogin() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    setTimeout(initGoogleLogin, 300);
    return;
  }
  try {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential, auto_select: false });
    google.accounts.id.renderButton(document.getElementById("google-btn-container"), {
      theme: "outline", size: "large", width: 296, shape: "pill", text: "continue_with"
    });
  } catch (e) {
    console.warn("Não foi possível iniciar o Google Sign-In:", e);
  }
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
function openConfiguracoes() {
  document.getElementById("cfg-nome").value = state.user?.name || "";
  document.getElementById("cfg-email").value = state.user?.email || "";
  document.getElementById("cfg-moeda").value = state.preferences.currency || "BRL";
  document.getElementById("cfg-modo-escuro").checked = document.documentElement.getAttribute("data-theme") === "dark";
  openModal("modal-configuracoes");
}
async function saveConfiguracoes() {
  const currency = document.getElementById("cfg-moeda").value;
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  try {
    await api("/me/preferences", { method: "PUT", body: { theme, currency } });
    state.preferences.currency = currency;
  } catch (e) { console.warn("não foi possível salvar configurações", e); }
  closeAllModals();
}

/* ============================================================
   PLUGGY (Open Finance) — conectar bancos reais, vários CPFs
   ============================================================ */
function renderPluggyItems() {
  const el = document.getElementById("pluggy-items-list");
  if (!el) return;
  if (!state.pluggyItems.length) {
    el.innerHTML = `<div class="empty-state">Nenhuma conta real conectada ainda.</div>`;
    return;
  }
  el.innerHTML = state.pluggyItems.map(p => `
    <div class="bank-row">
      <div class="bank-row-left">
        <div class="bank-avatar" style="background:${pluggyColorFor(p.item_id)}">${initials(p.institution_name || "Conta")}</div>
        <div>
          <div class="bank-row-name">${p.institution_name || "Conta conectada"}</div>
          <div class="bank-status connected"><span class="dot-status"></span>CPF ${maskCpf(p.cpf)} • última sinc.: ${p.last_sync ? new Date(p.last_sync).toLocaleString("pt-BR") : "nunca"}</div>
        </div>
      </div>
      <button class="btn-connect connected" data-pluggy-sync="${p.item_id}">Sincronizar</button>
      <button class="btn btn-danger" style="margin-left:6px;padding:8px 10px" data-pluggy-remove="${p.id}">Remover</button>
    </div>
  `).join("");
}
function maskCpf(cpf) {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0,3)}.***.**${digits.slice(9,11) ? "*-" + digits.slice(9,11) : ""}`;
}

let pluggyPendingCpf = null;

function openPluggyCpfModal() {
  document.getElementById("input-pluggy-cpf").value = "";
  document.getElementById("pluggy-error").classList.add("hidden");
  openModal("modal-pluggy-cpf");
}

async function startPluggyConnect() {
  const cpfInput = document.getElementById("input-pluggy-cpf").value.trim();
  const digits = cpfInput.replace(/\D/g, "");
  if (digits.length !== 11) {
    const err = document.getElementById("pluggy-error");
    err.textContent = "Informe um CPF válido (11 dígitos).";
    err.classList.remove("hidden");
    return;
  }
  pluggyPendingCpf = digits;
  closeAllModals();

  if (typeof PluggyConnect === "undefined") {
    alert("O widget do Pluggy ainda não carregou. Verifique sua conexão e tente novamente.");
    return;
  }

  try {
    const { connectToken } = await api("/pluggy/connect-token", { method: "POST" });
    const pluggyConnect = new PluggyConnect({
      connectToken,
      includeSandbox: true, // permite usar os conectores de teste do Pluggy em modo sandbox
      onSuccess: async (itemData) => {
        try {
          await api("/pluggy/items", {
            method: "POST",
            body: {
              itemId: itemData.item.id,
              cpf: pluggyPendingCpf,
              institutionName: itemData.item.connector?.name || "Conta conectada"
            }
          });
          await api(`/pluggy/sync/${itemData.item.id}`, { method: "POST" });
          await Promise.all([refreshPluggyItems(), refreshTransactions()]);
          renderScreen(currentScreen);
        } catch (e) {
          alert("Conectado, mas houve um erro ao salvar/sincronizar: " + e.message);
        }
      },
      onError: (error) => {
        console.error("Erro no Pluggy Connect:", error);
        alert("Não foi possível concluir a conexão com o banco.");
      }
    });
    pluggyConnect.init();
  } catch (e) {
    alert("Erro ao iniciar conexão com o Pluggy: " + e.message);
  }
}

async function syncPluggyItem(itemId) {
  try {
    const r = await api(`/pluggy/sync/${itemId}`, { method: "POST" });
    await refreshTransactions();
    renderScreen(currentScreen);
    alert(`Sincronizado! ${r.transacoesProcessadas} transações verificadas.`);
  } catch (e) {
    alert("Erro ao sincronizar: " + e.message);
  }
}

async function removePluggyItem(id) {
  if (!confirm("Remover esta conexão bancária?")) return;
  try {
    await api(`/pluggy/items/${id}`, { method: "DELETE" });
    await Promise.all([refreshPluggyItems(), refreshTransactions()]);
    renderScreen(currentScreen);
  } catch (e) {
    alert("Erro ao remover: " + e.message);
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wire(fn, label) {
  try { fn(); } catch (err) { console.error(`FinanApp: falha ao configurar "${label}"`, err); }
}

initTheme();

document.addEventListener("DOMContentLoaded", () => {

  wire(() => {
    document.getElementById("btn-email-login").addEventListener("click", () => { setAuthMode("login"); openModal("modal-email"); });
    document.getElementById("link-create-account").addEventListener("click", (e) => { e.preventDefault(); setAuthMode("register"); openModal("modal-email"); });
    document.getElementById("btn-do-email-login").addEventListener("click", async () => {
      clearAuthError();
      const name = document.getElementById("input-name").value.trim();
      const email = document.getElementById("input-email").value.trim();
      const password = document.getElementById("input-password").value;
      if (!email || !password) return showAuthError("Preencha e-mail e senha.");
      try {
        const result = authMode === "register"
          ? await auth.register(name || "Usuário", email, password)
          : await auth.login(email, password);
        closeAllModals();
        await afterLoginSuccess(result.token);
      } catch (err) {
        showAuthError(err.message);
      }
    });
  }, "login por e-mail");

  wire(() => {
    document.getElementById("btn-profile").addEventListener("click", () => openModal("modal-perfil"));
    document.getElementById("btn-logout").addEventListener("click", logoutUser);
    document.getElementById("btn-ajuda").addEventListener("click", () => alert("Precisa de ajuda? Fale com o suporte pelo e-mail eduardo8528233@gmail.com"));
    document.getElementById("btn-configuracoes").addEventListener("click", openConfiguracoes);
  }, "perfil");

  wire(() => {
    document.getElementById("cfg-modo-escuro").addEventListener("change", toggleTheme);
    document.getElementById("btn-salvar-config").addEventListener("click", saveConfiguracoes);
  }, "configurações");

  wire(() => {
    document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);
  }, "tema");

  wire(() => {
    document.getElementById("bottom-nav").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-btn");
      if (btn) navigateTo(btn.dataset.nav);
    });
    document.getElementById("content").addEventListener("click", (e) => {
      const navLink = e.target.closest("[data-nav]");
      if (navLink) { e.preventDefault(); navigateTo(navLink.dataset.nav); }
    });
    document.querySelectorAll(".profile-menu-item[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => navigateTo(btn.dataset.nav));
    });
  }, "navegação");

  wire(() => {
    document.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeAllModals));
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAllModals(); });
    });
  }, "fechar modais");

  wire(() => {
    document.getElementById("filter-periodo").addEventListener("change", (e) => { dashFilterPeriodo = e.target.value; renderDashboard(); });
    document.getElementById("filter-banco").addEventListener("change", (e) => { dashFilterBanco = e.target.value; renderDashboard(); });
    document.getElementById("btn-demo-data").addEventListener("click", async () => {
      const modoTeste = document.getElementById("chk-modo-teste").checked;
      await api("/demo", { method: "POST", body: { modoTeste } });
      await Promise.all([refreshInstitutions(), refreshTransactions()]);
      dashFilterPeriodo = "all"; dashFilterBanco = "all";
      renderScreen(currentScreen);
    });
  }, "filtros do dashboard");

  wire(() => {
    document.getElementById("btn-add-inst").addEventListener("click", openAddInstModal);
    document.body.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-toggle-bank]");
      if (toggleBtn) toggleBankConnection(toggleBtn.dataset.toggleBank);
    });
  }, "bancos");

  wire(() => {
    document.getElementById("btn-pluggy-connect").addEventListener("click", openPluggyCpfModal);
    document.getElementById("btn-pluggy-continuar").addEventListener("click", startPluggyConnect);
    document.getElementById("pluggy-items-list").addEventListener("click", (e) => {
      const syncBtn = e.target.closest("[data-pluggy-sync]");
      const removeBtn = e.target.closest("[data-pluggy-remove]");
      if (syncBtn) syncPluggyItem(syncBtn.dataset.pluggySync);
      if (removeBtn) removePluggyItem(removeBtn.dataset.pluggyRemove);
    });
  }, "pluggy");

  wire(() => {
    document.getElementById("search-transacoes").addEventListener("input", (e) => { txSearch = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-banco").addEventListener("change", (e) => { txFilterBanco = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-tipo").addEventListener("change", (e) => { txFilterTipo = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-categoria").addEventListener("change", (e) => { txFilterCategoria = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-list-container").addEventListener("click", (e) => {
      const loadMoreBtn = e.target.closest("#btn-load-more-tx");
      if (loadMoreBtn) { txVisibleCount += TX_PAGE_SIZE; renderTransacoes(); return; }
      const row = e.target.closest("[data-tx-id]");
      if (row) openTxDetalhe(row.dataset.txId);
    });
    document.getElementById("detalhe-body").addEventListener("click", (e) => {
      const alterarBtn = e.target.closest("#btn-alterar-categoria");
      const excluirBtn = e.target.closest("#btn-excluir-tx");
      if (alterarBtn) openCategoriaModal(alterarBtn.dataset.txId);
      if (excluirBtn) { if (confirm("Excluir esta transação?")) deleteTx(excluirBtn.dataset.txId); }
    });
    document.getElementById("cat-grid").addEventListener("click", (e) => {
      const item = e.target.closest("[data-cat-id]");
      if (!item) return;
      pendingCatSelected = item.dataset.catId;
      document.querySelectorAll("#cat-grid .cat-grid-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
    });
    document.getElementById("btn-salvar-categoria").addEventListener("click", saveCategoria);
  }, "transações");

  wire(() => {
    document.getElementById("cat-segmented").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      catSegment = btn.dataset.seg;
      document.querySelectorAll("#cat-segmented .seg-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderCategorias();
    });
  }, "categorias");

  wire(() => {
    document.getElementById("rel-segmented").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      relSegment = btn.dataset.seg;
      document.querySelectorAll("#rel-segmented .seg-btn").forEach(b => b.classList.toggle("active", b === btn));
      document.getElementById("rel-geral").classList.toggle("hidden", relSegment !== "geral");
      document.getElementById("rel-comparar").classList.toggle("hidden", relSegment !== "comparar");
    });
    ["rel-ano","rel-mes","rel-banco","rel-categoria"].forEach(id => {
      document.getElementById(id).addEventListener("change", computeRelGeral);
    });
    document.getElementById("btn-comparar").addEventListener("click", renderComparacao);
  }, "relatórios");

  wire(async () => {
    const token = getToken();
    if (!token) { showLogin(); return; }
    try {
      await refreshAll();
      applyTheme(state.preferences.theme || "light");
      localStorage.setItem(THEME_CACHE_KEY, state.preferences.theme || "light");
      applyUserToUI(state.user);
      showApp();
    } catch (e) {
      clearToken();
      showLogin();
    }
  }, "boot");

  wire(initGoogleLogin, "Google Sign-In");
});
