/* ============================================================
   Fluxo — front-end
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
  { id: "viagens", name: "Viagens", color: "#0EA5E9", icon: "✈️" },
  { id: "transferencias", name: "Transferências", color: "#64748B", icon: "🔁" },
  { id: "fatura", name: "Fatura do cartão", color: "#F97316", icon: "💳" },
  { id: "investimentos", name: "Investimentos", color: "#10B981", icon: "📈" },
  { id: "taxas", name: "Taxas e impostos", color: "#B45309", icon: "🧾" },
  { id: "outros", name: "Outros", color: "#9CA3AF", icon: "📦" },
  { id: "salario", name: "Salário", color: "#16A34A", icon: "💰" },
  { id: "nao_identificada", name: "Não identificada", color: "#CBD5E1", icon: "❓" }
];
function catInfo(id) { return allCategories().find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]; }
// Botão de olho do Início: esconde valores (e a lista de entradas/saídas) só nas telas do Início
let hideValues = localStorage.getItem("hideValues") === "1";
function valuesHidden() { return hideValues && (currentScreen === "inicio" || currentScreen === "entradas-saidas"); }
function fmtBRL(v) {
  if (valuesHidden()) return "R$ ••••";
  const sign = v < 0 ? "-" : "";
  return sign + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Escapa texto vindo de fora (descrição de Pix/compra, nome de conta) antes de colocar em innerHTML
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Logo real do banco (favicon do site oficial); se não carregar ou não for reconhecido, cai para as iniciais coloridas
const BANK_DOMAINS = [
  ["inter", "inter.co"], ["brasil", "bb.com.br"], ["caixa", "caixa.gov.br"], ["nubank", "nubank.com.br"], ["nu pagamentos", "nubank.com.br"],
  ["itau", "itau.com.br"], ["bradesco", "bradesco.com.br"], ["santander", "santander.com.br"], ["brb", "brb.com.br"],
  ["c6", "c6bank.com.br"], ["btg", "btgpactual.com"], ["mercado pago", "mercadopago.com.br"], ["mercadopago", "mercadopago.com.br"],
  ["sicoob", "sicoob.com.br"], ["sicredi", "sicredi.com.br"], ["xp", "xpi.com.br"], ["picpay", "picpay.com"], ["neon", "neon.com.br"]
];
function bankDomain(name) {
  const n = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hit = BANK_DOMAINS.find(([k]) => new RegExp("(^|[^a-z0-9])" + k + "([^a-z0-9]|$)").test(n));
  return hit ? hit[1] : null;
}
// cls = classe do quadradinho (bank-icon, tx-icon, bank-avatar); bankName = nome usado para achar a logo; text = iniciais de reserva
function bankLogo(cls, bankName, color, text) {
  const ini = initials(text || bankName);
  const dom = bankDomain(bankName);
  if (!dom) return `<div class="${cls}" style="background:${color}">${ini}</div>`;
  return `<div class="${cls} has-logo" style="background:#fff"><img src="https://www.google.com/s2/favicons?domain=${dom}&sz=128" alt="" loading="lazy" onerror="this.parentElement.style.background='${color}';this.parentElement.classList.remove('has-logo');this.parentElement.textContent='${ini}'"></div>`;
}
function initials(name) { return esc(String(name || "").split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
// O banco grava datas em UTC sem fuso ("2026-09-21 19:00:58"); sem isso o navegador lê como horário local e mostra 3h a mais
function parseDbDate(str) {
  if (!str) return null;
  const iso = /Z$|[+-]\d\d:\d\d$/.test(str) ? str : String(str).replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}
function fmtDateTime(str) { const d = parseDbDate(str); return d ? d.toLocaleString("pt-BR") : "nunca"; }
function fmtDate(str) {
  const m = String(str || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/* ============================================================
   FEEDBACK DE CARREGAMENTO (bolinhas girando)
   ============================================================ */
const SPINNER_DOTS = "<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>";
const SPINNER_SM = `<span class="dots-spinner sm" aria-hidden="true">${SPINNER_DOTS}</span>`;
const MIN_BTN_SPIN_MS = 500;
const SCREEN_LOADER_MS = 450;

// Mostra as bolinhas no botão enquanto a ação roda (mínimo de 0,5 s, mesmo se for instantânea) e bloqueia clique duplo.
async function withLoading(btn, fn, { minMs = MIN_BTN_SPIN_MS } = {}) {
  if (!btn) return fn();
  if (btn.dataset.loading === "1") return;
  btn.dataset.loading = "1";
  const original = btn.innerHTML;
  btn.classList.add("is-loading");
  btn.disabled = true;
  btn.innerHTML = SPINNER_SM + original;
  try {
    const [result] = await Promise.all([fn(), sleep(minMs)]);
    return result;
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.innerHTML = original;
    delete btn.dataset.loading;
  }
}
function showScreenLoader() { document.getElementById("screen-loader")?.classList.add("show"); }
function hideScreenLoader() { document.getElementById("screen-loader")?.classList.remove("show"); }
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
  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    // sessão expirou: volta para o login em vez de deixar o app "travado"
    clearToken(); state.user = null; hideScreenLoader(); showLogin();
    throw new Error("Sessão expirada. Entre novamente.");
  }
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
  transactions: [],
  pluggyItems: [],
  accounts: [],
  customCategories: [],
  categoryOverrides: {}
};

async function refreshMe() {
  const { user, preferences } = await api("/me");
  state.user = user;
  state.preferences = preferences;
  return user;
}
// Cada transação passa a apontar para a CONTA (banco ou cartão) e não para a conexão MeuPluggy,
// assim os filtros e gráficos diferenciam Banco Inter, Cartão, etc.
async function refreshTransactions() {
  const rows = await api("/transactions");
  state.transactions = rows.map(t => ({ ...t, bank_id: t.account_id || t.bank_id }));
}
async function refreshAccounts() {
  try { state.accounts = await api("/pluggy/accounts"); }
  catch (e) { state.accounts = []; }
}
async function refreshInvestments() {
  try { const r = await api("/investments"); state.investments = r.investments || []; state.investHistory = r.history || []; }
  catch (e) { state.investments = []; state.investHistory = []; }
}
async function refreshPluggyItems() {
  try { state.pluggyItems = await api("/pluggy/items"); }
  catch (e) { state.pluggyItems = []; }
}
async function refreshCategories() {
  try {
    const r = await api("/categories");
    state.customCategories = r.custom || [];
    state.categoryOverrides = r.overrides || {};
  } catch (e) {
    state.customCategories = [];
    state.categoryOverrides = {};
  }
}
async function refreshAll() {
  await Promise.all([refreshMe(), refreshTransactions(), refreshPluggyItems(), refreshAccounts(), refreshCategories(), refreshInvestments()]);
}
// Todas as categorias disponíveis (fixas + criadas pelo usuário), sempre com
// "Não identificada" por último.
function allCategories() {
  const ov = state.categoryOverrides || {};
  const applyOverride = (c) => {
    const o = ov[c.id];
    if (!o) return c;
    return { ...c, name: o.name || c.name, icon: o.icon || c.icon, color: o.color || c.color };
  };
  const fixed = CATEGORIES.filter(c => c.id !== "nao_identificada" && !(ov[c.id] && ov[c.id].deleted)).map(applyOverride);
  const last = applyOverride(CATEGORIES.find(c => c.id === "nao_identificada"));
  return [...fixed, ...state.customCategories, last];
}
// Categorias editáveis/excluíveis na grade "Alterar categoria" — tudo, menos
// "Outros" (destino de fallback) e "Não identificada" (estado especial, não é categoria de verdade).
function editableCategories() {
  return allCategories().filter(c => c.id !== "outros" && c.id !== "nao_identificada");
}

const PLUGGY_COLOR_PALETTE = ["#2563EB", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#DB2777"];
function pluggyColorFor(itemId) {
  let hash = 0;
  for (let i = 0; i < itemId.length; i++) hash = (hash * 31 + itemId.charCodeAt(i)) >>> 0;
  return PLUGGY_COLOR_PALETTE[hash % PLUGGY_COLOR_PALETTE.length];
}
function isPluggyBank(bankId) {
  return state.accounts.some(a => a.account_id === bankId) || state.pluggyItems.some(p => p.item_id === bankId);
}
// "BANCO INTER" -> "Banco Inter"; cartão de crédito ganha o prefixo "Cartão"
function prettyName(str) {
  return (str || "").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}
function accountLabel(a) {
  const n = prettyName(a.name) || "Conta";
  return a.type === "CREDIT" ? `Cartão ${n}` : n;
}
// Contas (bancos e cartões) no formato usado pelos filtros: { id, name, color, type, balance }
function connectedBanks() {
  return state.accounts.map(a => ({
    id: a.account_id, name: accountLabel(a), color: pluggyColorFor(a.account_id),
    logoName: prettyName((state.accounts.find(x => x.item_id === a.item_id && x.type !== "CREDIT") || a).name),
    type: a.type, balance: a.balance, connected: true
  }));
}
function instInfo(id, fallbackName) {
  const acc = connectedBanks().find(b => b.id === id);
  if (acc) return acc;
  const pluggy = state.pluggyItems.find(p => p.item_id === id);
  if (pluggy) return { id, name: pluggy.institution_name || "Conta conectada", color: pluggyColorFor(id), connected: true };
  return { name: prettyName(fallbackName) || "Conta", color: "#94A3B8" };
}
function isCreditTx(t) { return t.account_type === "CREDIT"; }
function bankAccountsOnly() { return connectedBanks().filter(b => b.type !== "CREDIT"); }
function accountTypeLabel(a) {
  const map = { CHECKING_ACCOUNT: "Conta corrente", SAVINGS_ACCOUNT: "Poupança", CREDIT_CARD: "Cartão de crédito" };
  return map[a.data?.subtype] || (a.type === "CREDIT" ? "Cartão de crédito" : "Conta bancária");
}
// limite usado do cartão: limite total − disponível; se faltar, usa o saldo informado
function cardUsed(a) {
  const c = a.data?.creditData || {};
  const limit = num(c.creditLimit), avail = num(c.availableCreditLimit);
  return limit !== null && avail !== null ? limit - avail : num(a.balance);
}
function effectiveCategory(t) { return t.category; }
// "chute" da IA (modelo treinado no seu histórico ou Claude): aparece com ✨ para você confirmar ou corrigir
function isGuess(t) { return t.category_source === "model" || t.category_source === "llm"; }
function needsReview(t) { return !Number(t.category_manual) && (t.category === "nao_identificada" || isGuess(t)); }
function sourceLabel(t) {
  if (Number(t.category_manual) || t.category_source === "manual") return "Você";
  return { learned: "Aprendido com suas correções", rule: "Regra automática", pluggy: "Categoria do banco", model: "IA (seu histórico) ✨", llm: "IA (Claude) ✨" }[t.category_source] || (t.category === "nao_identificada" ? "—" : "Automática");
}

/* ============================================================
   APP STATE (filtros de tela)
   ============================================================ */
let currentScreen = "inicio";
let dashFilterPeriodo = "all";
let dashFilterBanco = "all";
let txSearch = "";
let txFilterPeriodo = "all";
let txFilterBanco = "all";
let txFilterTipo = "all";
let txFilterCategoria = "all";
let esTipo = "entrada";
let catSegment = "gastos";
let catDetalhe = null;
let relSegment = "geral";
let pendingCatTxId = null;
let pendingCatSelected = null;
let editingCatId = null;
let novaCatOrigin = null; // "review" | null — de onde o modal "Nova categoria" foi aberto, pra saber pra onde voltar depois de salvar
const TX_PAGE_SIZE = 10;
let txVisibleCount = TX_PAGE_SIZE;

/* ============================================================
   TEMA (claro/escuro) — preferência salva no backend, cacheada
   localmente só para aplicar sem "flash" ao abrir o app.
   ============================================================ */
const THEME_CACHE_KEY = "fh_theme_cache";
/* ---------- cores do app (paletas prontas) ---------- */
const ACCENTS = {
  verde:   { name: "Verde",   light: ["#059669","#064E3B","#047857","#064E3B","5,150,105"],  dark: ["#10B981","#052E22","#047857","#064E3B","16,185,129"] },
  azul:    { name: "Azul",    light: ["#2563EB","#1E3A8A","#1D4ED8","#172554","37,99,235"],   dark: ["#3B82F6","#0B1930","#1D4ED8","#172554","59,130,246"] },
  roxo:    { name: "Roxo",    light: ["#7C3AED","#4C1D95","#6D28D9","#3B0764","124,58,237"],  dark: ["#8B5CF6","#2E1065","#6D28D9","#3B0764","139,92,246"] },
  vermelho:{ name: "Vermelho",light: ["#DC2626","#7F1D1D","#B91C1C","#450A0A","220,38,38"],   dark: ["#EF4444","#450A0A","#B91C1C","#450A0A","239,68,68"] },
  laranja: { name: "Laranja", light: ["#EA580C","#7C2D12","#C2410C","#431407","234,88,12"],   dark: ["#FB923C","#431407","#C2410C","#431407","251,146,60"] },
  rosa:    { name: "Rosa",    light: ["#DB2777","#831843","#BE185D","#500724","219,39,119"],  dark: ["#F472B6","#500724","#BE185D","#500724","244,114,182"] }
};
function currentAccent() { const a = localStorage.getItem("accent"); return ACCENTS[a] ? a : "verde"; }
function applyAccent() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const [base, deep1, mid, deep, rgb] = ACCENTS[currentAccent()][dark ? "dark" : "light"];
  const st = document.documentElement.style;
  st.setProperty("--blue", base); st.setProperty("--blue-dark", deep1);
  // cor de "saída/gasto": nunca amarela; no tema vermelho usa um carmim/rosa mais fechado para não brigar com o destaque
  const out = { vermelho: dark ? "#FB7185" : "#BE123C", rosa: dark ? "#F87171" : "#E5484D" }[currentAccent()] || (dark ? "#FB7185" : "#E5484D");
  st.setProperty("--out", out);
  st.setProperty("--accent-mid", mid); st.setProperty("--accent-deep", deep); st.setProperty("--accent-rgb", rgb);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ACCENTS[currentAccent()].light[0]);
}
function renderAccentPicker() {
  const el = document.getElementById("accent-picker"); if (!el) return;
  const cur = currentAccent();
  el.innerHTML = Object.entries(ACCENTS).map(([id, a]) =>
    `<button type="button" class="accent-dot${id === cur ? " active" : ""}" data-accent="${id}" style="background:${a.light[0]}" title="${a.name}" aria-label="${a.name}"></button>`).join("");
}

/* ---------- abas de baixo: ordem e visibilidade ---------- */
const NAV_DEFS = {
  inicio:       { label: "Início",        svg: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>' },
  transacoes:   { label: "Transações",    svg: '<path d="M7 8h13M7 8l3-3M7 8l3 3M17 16H4M17 16l-3-3M17 16l-3 3"/>' },
  categorias:   { label: "Categorias",    svg: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>' },
  relatorios:   { label: "Relatórios",    svg: '<path d="M4 19V9M12 19V5M20 19v-7"/>' },
  investimentos:{ label: "Investimentos", svg: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  creditos:     { label: "Créditos",      svg: '<path d="M12 21s-7-4.6-9.3-9A5.2 5.2 0 0112 6a5.2 5.2 0 019.3 6c-2.3 4.4-9.3 9-9.3 9z"/>' },
  bancos:       { label: "Meus bancos",   svg: '<path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/>' }
};
const NAV_DEFAULT = { order: ["inicio","transacoes","categorias","relatorios","investimentos","bancos","creditos"], hidden: ["bancos","creditos"] };
function getNavCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("navCfg") || "null");
    if (c && Array.isArray(c.order)) {
      const order = c.order.filter(id => NAV_DEFS[id]);
      const hidden = (c.hidden || []).filter(id => NAV_DEFS[id]);
      Object.keys(NAV_DEFS).forEach(id => { if (!order.includes(id)) { order.push(id); hidden.push(id); } }); // abas novas começam escondidas
      return { order, hidden };
    }
  } catch (e) { /* usa o padrão */ }
  return JSON.parse(JSON.stringify(NAV_DEFAULT));
}
function saveNavCfg(c) { localStorage.setItem("navCfg", JSON.stringify(c)); renderBottomNav(); }
function renderBottomNav() {
  const nav = document.getElementById("bottom-nav"); if (!nav) return;
  const c = getNavCfg();
  const active = currentScreen === "categoria-detalhe" ? "categorias" : currentScreen;
  nav.innerHTML = c.order.filter(id => !c.hidden.includes(id)).map(id =>
    `<button class="nav-btn${id === active ? " active" : ""}" data-nav="${id}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${NAV_DEFS[id].svg}</svg>
      <span>${NAV_DEFS[id].label}</span></button>`).join("");
}
function normalizeNav(c) { // escondidas sempre no fim da lista
  c.order = [...c.order.filter(id => !c.hidden.includes(id)), ...c.order.filter(id => c.hidden.includes(id))];
  return c;
}
function renderNavEditor() {
  const el = document.getElementById("nav-editor"); if (!el) return;
  const c = normalizeNav(getNavCfg());
  const firstOff = c.order.findIndex(id => c.hidden.includes(id));
  el.innerHTML = c.order.map((id, i) => {
    const off = c.hidden.includes(id);
    return (i === firstOff ? `<li class="nav-sep">Escondidas</li>` : "") + `<li class="nav-edit-item${off ? " off" : ""}" data-id="${id}">
      <span class="nav-handle" title="Arraste para mudar a ordem">☰</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${NAV_DEFS[id].svg}</svg>
      <span class="nav-edit-name">${NAV_DEFS[id].label}</span>
      <button type="button" class="nav-eye" data-toggle="${id}" aria-label="${off ? "Mostrar" : "Esconder"} ${NAV_DEFS[id].label}">${off ? "🙈" : "👁"}</button>
    </li>`;
  }).join("");
}
// anima a troca de lugar dos itens (FLIP): mede antes, muda, e desliza do lugar antigo para o novo
function flipItems(el, mutate) {
  const before = new Map([...el.querySelectorAll(".nav-edit-item")].map(li => [li.dataset.id, li.getBoundingClientRect().top]));
  mutate();
  el.querySelectorAll(".nav-edit-item").forEach(li => {
    const old = before.get(li.dataset.id); if (old == null) return;
    const dy = old - li.getBoundingClientRect().top; if (!dy) return;
    li.style.transition = "none"; li.style.transform = `translateY(${dy}px)`;
    void li.offsetWidth;
    li.style.transition = "transform .22s ease"; li.style.transform = "";
  });
}
function wireNavEditor() {
  const el = document.getElementById("nav-editor"); if (!el || el.dataset.wired) return;
  el.dataset.wired = "1";
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle]"); if (!b) return;
    const c = getNavCfg(), id = b.dataset.toggle;
    if (c.hidden.includes(id)) {
      if (c.order.length - c.hidden.length >= 5) { showToast("No máximo 5 abas na barra. Esconda uma antes."); return; }
      c.hidden = c.hidden.filter(x => x !== id);
    } else {
      if (c.order.length - c.hidden.length <= 2) { showToast("Deixe pelo menos 2 abas visíveis."); return; }
      c.hidden.push(id);
    }
    normalizeNav(c); saveNavCfg(c);
    flipItems(el, renderNavEditor);
  });
  let drag = null, grab = 0;
  const place = (y) => {
    const h = drag.offsetHeight;
    const others = [...el.querySelectorAll(".nav-edit-item")].filter(li => li !== drag);
    const center = y - grab + h / 2;
    const after = others.find(li => { const r = li.getBoundingClientRect(); return center < r.top + r.height / 2; });
    const tops = new Map(others.map(li => [li, li.getBoundingClientRect().top]));
    if (after) { if (drag.nextElementSibling !== after) el.insertBefore(drag, after); } else if (drag !== el.lastElementChild) el.appendChild(drag);
    others.forEach(li => { // os outros deslizam suavemente para abrir espaço
      const dy = tops.get(li) - li.getBoundingClientRect().top; if (!dy) return;
      li.style.transition = "none"; li.style.transform = `translateY(${dy}px)`; void li.offsetWidth;
      li.style.transition = "transform .18s ease"; li.style.transform = "";
    });
    drag.style.transform = "none"; const natural = drag.getBoundingClientRect().top;
    drag.style.transform = `translateY(${y - grab - natural}px) scale(1.03)`;
  };
  el.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".nav-handle"); if (!h) return;
    drag = h.closest(".nav-edit-item"); grab = e.clientY - drag.getBoundingClientRect().top;
    drag.classList.add("dragging"); drag.style.transition = "box-shadow .15s ease";
    h.setPointerCapture(e.pointerId); e.preventDefault(); place(e.clientY);
  });
  el.addEventListener("pointermove", (e) => { if (drag) place(e.clientY); });
  const end = () => {
    if (!drag) return;
    const li = drag; drag = null;
    li.style.transition = "transform .2s ease, box-shadow .2s ease"; li.style.transform = "translateY(0) scale(1)"; // "solta" no lugar
    li.classList.remove("dragging");
    const c = getNavCfg(); c.order = [...el.querySelectorAll(".nav-edit-item")].map(x => x.dataset.id);
    normalizeNav(c); saveNavCfg(c);
    setTimeout(renderNavEditor, 220);
  };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  document.getElementById("btn-nav-reset").addEventListener("click", () => { saveNavCfg(JSON.parse(JSON.stringify(NAV_DEFAULT))); renderNavEditor(); });
  document.getElementById("accent-picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accent]"); if (!b) return;
    localStorage.setItem("accent", b.dataset.accent); applyAccent(); renderAccentPicker();
    if (currentScreen === "categorias") renderCategorias();
  });
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const sun = document.getElementById("theme-icon-sun");
  const moon = document.getElementById("theme-icon-moon");
  if (sun && moon) {
    sun.classList.toggle("hidden", theme === "dark");
    moon.classList.toggle("hidden", theme !== "dark");
  }
  applyAccent();
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
  const last = localStorage.getItem("lastScreen");
  navigateTo(last && NAV_DEFS[last] ? last : "inicio", { refresh: last && NAV_DEFS[last] && last !== "inicio" });
  setTimeout(checkReviewPrompt, 700);
  setTimeout(() => autoSyncAll(), 2500);
}
function navigateTo(screen, { refresh = true } = {}) {
  const remember = screen === "categoria-detalhe" ? "categorias" : screen;
  if (NAV_DEFS[remember]) localStorage.setItem("lastScreen", remember); // ao reabrir o app volta para onde você parou
  if (screen === "transacoes" && currentScreen !== "transacoes") txVisibleCount = TX_PAGE_SIZE;
  currentScreen = screen;
  document.querySelectorAll(".content .screen").forEach(s => s.classList.remove("active"));
  const target = document.querySelector(`.screen[data-screen="${screen}"]`);
  if (target) {
    void target.offsetWidth;
    target.classList.add("active");
  }
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === (screen === "categoria-detalhe" ? "categorias" : screen)));
  const titles = { inicio: "Início", bancos: "Minhas instituições", investimentos: "Investimentos", creditos: "Créditos", "categoria-detalhe": catDetalhe ? catInfo(catDetalhe).name : "Categoria", transacoes: "Transações", categorias: "Categorias", relatorios: "Relatórios", "entradas-saidas": esTipo === "entrada" ? "Entradas" : "Saídas" };
  document.getElementById("topbar-title").textContent = titles[screen] || "";
  const backBtn = document.getElementById("btn-back");
  if (backBtn) backBtn.classList.toggle("hidden", screen !== "entradas-saidas" && screen !== "categoria-detalhe");
  renderScreen(screen);
  document.getElementById("content").scrollTop = 0;
  loadScreenData(screen, refresh);
}
// Bolinhas ao trocar de tela; aproveita para buscar dados novos no servidor e redesenhar a tela.
let navToken = 0;
async function loadScreenData(screen, refresh) {
  const mine = ++navToken;
  showScreenLoader();
  try {
    const fetching = refresh && state.user
      ? Promise.all([refreshTransactions(), refreshAccounts(), refreshPluggyItems(), refreshInvestments()])
      : Promise.resolve();
    await Promise.all([fetching, sleep(SCREEN_LOADER_MS)]);
    if (mine === navToken && refresh && state.user && currentScreen === screen) renderScreen(screen);
  } catch (e) {
    console.warn("não foi possível atualizar os dados:", e.message);
  } finally {
    if (mine === navToken) hideScreenLoader();
  }
}
function renderScreen(screen) {
  if (screen === "inicio") renderDashboard();
  if (screen === "bancos") renderBancos();
  if (screen === "investimentos") renderInvestimentos();
  if (screen === "transacoes") renderTransacoes();
  if (screen === "entradas-saidas") renderEntradasSaidas();
  if (screen === "categorias") renderCategorias();
  if (screen === "categoria-detalhe") renderCategoriaDetalhe();
  if (screen === "relatorios") renderRelatorios();
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */
function getAvailableMonths() {
  const set = new Set(state.transactions.map(t => t.date.slice(0,7)));
  return Array.from(set).sort().reverse();
}
// Períodos rápidos da tela de Transações (datas no fuso do aparelho, não em UTC)
const TX_PERIODS = [
  { id: "all", label: "Todo o período" },
  { id: "today", label: "Hoje" },
  { id: "3d", label: "Últimos 3 dias" },
  { id: "7d", label: "Última semana" },
  { id: "15d", label: "Últimos 15 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "month", label: "Este mês" },
  { id: "lastmonth", label: "Mês passado" },
  { id: "90d", label: "Últimos 3 meses" }
];
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function periodRange(id) {
  const now = new Date();
  const today = ymdLocal(now);
  const back = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return ymdLocal(d); };
  const days = { "3d": 3, "7d": 7, "15d": 15, "30d": 30, "90d": 90 };
  if (id === "today") return { from: today, to: today };
  if (days[id]) return { from: back(days[id] - 1), to: today };
  if (id === "month") return { from: today.slice(0, 8) + "01", to: today };
  if (id === "lastmonth") {
    return { from: ymdLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymdLocal(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  return null;
}
function filterTx(txs, { periodo, range, banco, tipo, categoria, search } = {}) {
  return txs.filter(t => {
    if (range && (t.date < range.from || t.date > range.to)) return false;
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
  const institutions = bankAccountsOnly();
  if (dashFilterBanco !== "all" && !institutions.some(i => i.id === dashFilterBanco)) dashFilterBanco = "all";
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    institutions.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  bancoSel.value = dashFilterBanco;
}
function monthLabel(ym) {
  const [y,m] = ym.split("-");
  return `${MONTH_NAMES[parseInt(m)-1]} ${y}`;
}

function renderDashboard() {
  populateDashboardFilters();
  let txs = filterTx(state.transactions, { periodo: dashFilterPeriodo, banco: dashFilterBanco });
  // Cartão de crédito tem seção própria: entradas, saídas e categorias aqui contam só contas bancárias
  // (senão o pagamento da fatura entraria duas vezes).
  txs = txs.filter(t => !isCreditTx(t));
  const entradas = txs.filter(t => t.type === "entrada").reduce((s,t) => s + t.value, 0);
  const saidas = txs.filter(t => t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);

  // Saldo = saldo real informado pelo banco. Sem contas sincronizadas ainda, usa entradas − saídas.
  const banks = bankAccountsOnly();
  const saldoContas = banks.filter(b => (dashFilterBanco === "all" || b.id === dashFilterBanco) && typeof b.balance === "number");
  const saldo = saldoContas.length ? saldoContas.reduce((s,b) => s + b.balance, 0) : entradas - saidas;

  document.getElementById("balance-total").textContent = fmtBRL(saldo);
  document.getElementById("total-entradas").textContent = fmtBRL(entradas);
  document.getElementById("total-saidas").textContent = fmtBRL(saidas);
  document.getElementById("balance-change").textContent = txs.length ? `${txs.length} transações no período` : "Nenhuma transação no período";

  const banksScroll = document.getElementById("banks-scroll");
  banksScroll.innerHTML = banks.map(i => {
    const val = typeof i.balance === "number" ? i.balance : state.transactions.filter(t => t.bank_id === i.id).reduce((s,t) => s + t.value, 0);
    return `<div class="bank-chip">
      ${bankLogo("bank-icon", i.logoName || i.name, i.color, i.name)}
      <div class="bank-amount">${fmtBRL(val)}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${esc(i.name)}</div>
    </div>`;
  }).join("") + `<button type="button" class="bank-chip add-bank-chip" data-nav="bancos">
      <div class="bank-icon add-icon">+</div>
      <div class="bank-amount">Adicionar</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">banco</div>
    </button>`;

  renderCards();
}

function applyHideUI() {
  document.getElementById("eye-open")?.classList.toggle("hidden", hideValues);
  document.getElementById("eye-closed")?.classList.toggle("hidden", !hideValues);
}
function toggleHideValues() {
  hideValues = !hideValues;
  localStorage.setItem("hideValues", hideValues ? "1" : "0");
  applyHideUI();
  renderDashboard();
}
function openEntradasSaidas(tipo) {
  if (valuesHidden()) { showToast("Valores escondidos. Toque no olho para mostrar."); return; }
  esTipo = tipo;
  navigateTo("entradas-saidas", { refresh: false });
}
function renderEntradasSaidas() {
  const tipo = esTipo;
  document.getElementById("topbar-title").textContent = tipo === "entrada" ? "Entradas" : "Saídas";
  const txs = filterTx(state.transactions, { periodo: dashFilterPeriodo, banco: dashFilterBanco })
    .filter(t => !isCreditTx(t) && t.type === tipo)
    .sort((a,b) => b.date.localeCompare(a.date));
  const container = document.getElementById("es-list-container");
  if (!txs.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma ${tipo === "entrada" ? "entrada" : "saída"} no período.</div>`;
    return;
  }
  const groups = {};
  txs.forEach(t => {
    const info = instInfo(t.bank_id, t.account_name);
    const key = info.name;
    if (!groups[key]) groups[key] = { info, items: [], total: 0 };
    groups[key].items.push(t);
    groups[key].total += Math.abs(t.value);
  });
  const names = Object.keys(groups).sort((a,b) => groups[b].total - groups[a].total);
  container.innerHTML = names.map(name => {
    const g = groups[name];
    return `<div class="es-bank-group">
      <div class="es-bank-head">
        <div class="es-bank-name">${bankLogo("tx-icon", g.info.logoName || name, g.info.color, name)}${esc(name)}</div>
        <div class="es-bank-total ${tipo === "entrada" ? "pos" : "neg"}">${tipo === "entrada" ? "+ " : "- "}${fmtBRL(g.total)}</div>
      </div>
      ${g.items.map(t => txRowHtml(t)).join("")}
    </div>`;
  }).join("");
}

/* ============================================================
   CARTÕES DE CRÉDITO (seção própria, com tudo que o Pluggy traz)
   ============================================================ */
function kvRow(label, valueHtml) {
  if (valueHtml === null || valueHtml === undefined || valueHtml === "") return "";
  return `<div class="kv-row"><span>${esc(label)}</span><span>${valueHtml}</span></div>`;
}
const money = (v) => (num(v) !== null ? fmtBRL(v) : null);

function cardHtml(a) {
  const d = a.data || {};
  const c = d.creditData || {};
  const color = pluggyColorFor(a.account_id);
  const title = prettyName(d.marketingName || a.name) || "Cartão";
  const limit = num(c.creditLimit), avail = num(c.availableCreditLimit), used = cardUsed(a);
  const pct = limit ? Math.min(100, Math.max(0, ((used || 0) / limit) * 100)) : null;
  const bills = [...(a.bills || [])].sort((x, y) => String(y.dueDate).localeCompare(String(x.dueDate)));
  const bill = bills[0];
  const spent = -state.transactions.filter(t => t.bank_id === a.account_id).reduce((s, t) => s + t.value, 0);
  const sub = [c.brand, c.level].filter(Boolean).map(esc).join(" ") + (d.number ? ` • final ${esc(d.number)}` : "");

  return `<div class="credit-card-item">
    <div class="credit-card-top" style="background:${color}">
      <div class="credit-card-name">${esc(title)}</div>
      <div class="credit-card-sub">${sub || "Cartão de crédito"}</div>
    </div>
    <div class="credit-card-body">
      ${pct !== null ? `<div class="limit-bar"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>` : ""}
      <div class="limit-highlight-row">
        <div class="limit-highlight">
          <span class="limit-highlight-label">Limite total</span>
          <span class="limit-highlight-value">${money(limit) || "—"}</span>
        </div>
        <div class="limit-highlight">
          <span class="limit-highlight-label">Limite disponível</span>
          <span class="limit-highlight-value">${money(avail) || "—"}</span>
        </div>
      </div>
      ${bill
        ? kvRow(`Fatura (vence ${fmtDate(bill.dueDate) || "—"})`, money(bill.totalAmount))
        : kvRow("Vencimento", esc(fmtDate(c.balanceDueDate)))}
      ${kvRow("Fechamento", esc(fmtDate(bill ? (bill.billClosingDate || c.balanceCloseDate) : c.balanceCloseDate)))}
      ${kvRow("Pagamento mínimo", money(bill ? bill.minimumPaymentAmount : c.minimumPayment))}
      ${kvRow("Compras registradas nas transações", money(spent))}
      <button class="btn-connect card-tx-btn" data-card-tx="${esc(a.account_id)}">Ver transações do cartão</button>
    </div>
  </div>`;
}

function renderCards() {
  const wrap = document.getElementById("cards-wrap");
  const list = document.getElementById("cards-list");
  if (!wrap || !list) return;
  const cards = state.accounts.filter(a => a.type === "CREDIT");
  wrap.classList.toggle("hidden", !cards.length);
  list.innerHTML = cards.map(cardHtml).join("");
}

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
function drawDonut(canvasId, byCat, total, label = "gastos") {
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
  ctx.fillText(label, cx, cy+18);
}

function renderLegend(elId, byCat, total) {
  const el = document.getElementById(elId);
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  if (!entries.length) { el.innerHTML = `<div class="empty-state">Nenhuma transação no período.</div>`; return; }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? ((val/total)*100).toFixed(1) : "0.0";
    return `<div class="legend-row" data-cat="${cat}">
      <div class="legend-left"><span class="legend-dot" style="background:${info.color}"></span>${info.icon} ${info.name}</div>
      <div><span class="legend-pct">${pct}%</span> &nbsp; ${fmtBRL(val)}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   DETALHE DA CATEGORIA (só gastos ou só ganhos daquela categoria)
   ============================================================ */
function openCategoriaDetalhe(cat) {
  catDetalhe = cat;
  navigateTo("categoria-detalhe", { refresh: false });
}
function renderCategoriaDetalhe() {
  const info = catInfo(catDetalhe);
  const isGasto = catSegment === "gastos";
  document.getElementById("topbar-title").textContent = info.name;
  const txs = state.transactions
    .filter(t => (isGasto ? t.type === "saida" : t.type === "entrada") && effectiveCategory(t) === catDetalhe)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = txs.reduce((s, t) => s + Math.abs(t.value), 0);
  const el = document.getElementById("catdet-container");
  const head = `<div class="card catdet-head">
    <div class="cat-icon" style="background:${info.color}">${info.icon}</div>
    <div><div class="cat-name">${esc(info.name)}</div>
    <div class="cat-pct">${txs.length} ${isGasto ? "gasto" : "ganho"}${txs.length === 1 ? "" : "s"}</div></div>
    <div class="cat-amount catdet-total ${isGasto ? "neg" : "pos"}">${fmtBRL(total)}</div>
  </div>`;
  el.innerHTML = head + (txs.length ? `<div class="es-bank-group">${txs.map(t => txRowHtml(t)).join("")}</div>` : `<div class="empty-state">Nenhuma transação nesta categoria.</div>`);
}

/* ============================================================
   INVESTIMENTOS
   ============================================================ */
function itemTitle(itemId) {
  const accs = (state.accounts || []).filter(a => a.item_id === itemId && a.type !== "CREDIT");
  const p = (state.pluggyItems || []).find(x => x.item_id === itemId);
  return accs.length ? accs.map(a => prettyName(a.name)).join(" • ") : (p?.institution_name || "Banco");
}
// Saldo de um investimento ~30 dias atrás (snapshot mais próximo, sem passar de 30 dias). null = ainda sem histórico.
function invBalanceAgo(invId, days = 30) {
  const today = ymdLocal(new Date());
  const target = ymdLocal(new Date(Date.now() - days * 86400000));
  const rows = (state.investHistory || []).filter(r => r.inv_id === invId);
  const before = rows.filter(r => r.day <= target).pop();
  if (before) return { balance: before.balance, day: before.day };
  // ainda não tem 30 dias de histórico: compara com o primeiro dia registrado (se não for hoje)
  const first = rows[0];
  if (first && first.day < today) return { balance: first.balance, day: first.day, since: true };
  return null;
}
function deltaHtml(now, ago) {
  if (!ago) return `<span class="inv-muted">Comparação começa a valer a partir de hoje</span>`;
  const d = now - ago.balance, cls = d >= 0 ? "pos" : "neg";
  return `<span class="inv-delta ${cls}">${d >= 0 ? "▲ +" : "▼ "}${fmtBRL(d)}</span> <span class="inv-muted">${ago.since ? "desde" : "vs"} ${fmtDate(ago.day)} (${fmtBRL(ago.balance)})</span>`;
}
async function editInvDate(invId, current) {
  const shown = current ? current.split("-").reverse().join("/") : "";
  const ans = prompt("Data em que você aplicou (dd/mm/aaaa):", shown);
  if (ans === null) return;
  const m = ans.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) { showToast("Use o formato dd/mm/aaaa", { error: true }); return; }
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  try { await api(`/investments/${encodeURIComponent(invId)}/date`, { method: "PUT", body: { date: iso } }); await refreshInvestments(); renderInvestimentos(); }
  catch (e) { showToast(e.message || "Não foi possível salvar", { error: true }); }
}
function renderInvestimentos() {
  const invs = (state.investments || []).filter(v => v.balance > 0 || v.balance < 0);
  const list = document.getElementById("inv-list");
  const total = invs.reduce((s, v) => s + (v.balance || 0), 0);
  document.getElementById("inv-total").textContent = fmtBRL(total);
  if (!invs.length) {
    document.getElementById("inv-change").textContent = "Nenhum investimento encontrado";
    list.innerHTML = `<div class="empty-state">Nenhum banco conectado tem investimentos. Se você investe e não aparece, toque em Sincronizar em "Meus bancos".</div>`;
    return;
  }
  const yieldOf = (v) => (v.amount_original != null ? v.balance - v.amount_original : (v.profit != null ? v.profit : null));
  const known = invs.filter(v => yieldOf(v) !== null);
  const totalYield = known.reduce((s, v) => s + yieldOf(v), 0);
  const fmtYield = (y) => `<span class="inv-delta ${y >= 0 ? "pos" : "neg"}">${y >= 0 ? "+" : "-"}${fmtBRL(Math.abs(y))}</span>`;
  document.getElementById("inv-change").innerHTML = known.length ? `Rendeu ${fmtYield(totalYield)} até hoje` : "";
  const byItem = {};
  invs.forEach(v => (byItem[v.item_id] = byItem[v.item_id] || []).push(v));
  list.innerHTML = Object.entries(byItem).map(([itemId, arr]) => {
    const sub = arr.reduce((s, v) => s + v.balance, 0);
    const rows = arr.map(v => {
      const y = yieldOf(v);
      const aplic = v.amount_original != null ? `Aplicado ${fmtBRL(v.amount_original)}` : "";
      return `<div class="inv-row">
        <div class="inv-row-top"><div class="inv-name">${esc(v.name)}</div><div class="inv-bal">${fmtBRL(v.balance)}</div></div>
        <div class="inv-muted">${aplic}${aplic && y !== null ? " · " : ""}${y !== null ? "Rendeu " + fmtYield(y) : ""}</div>
      </div>`;
    }).join("");
    return `<div class="card inv-bank"><div class="inv-bank-head"><div class="inv-bank-title">${bankLogo("bank-avatar sm", itemTitle(itemId), "#059669")}<h3>${esc(itemTitle(itemId))}</h3></div><strong>${fmtBRL(sub)}</strong></div>${rows}</div>`;
  }).join("");
}

/* ============================================================
   BANCOS
   ============================================================ */
function renderBancos() {
  renderPluggyItems();
}

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
function populateTxFilters() {
  const periodoSel = document.getElementById("tx-filter-periodo");
  periodoSel.innerHTML = TX_PERIODS.map(p => `<option value="${p.id}">${p.label}</option>`).join("");
  periodoSel.value = txFilterPeriodo;
  const bancoSel = document.getElementById("tx-filter-banco");
  // cartão não aparece como opção de filtro (só bancos); a exceção é quando o usuário
  // abriu "Ver transações do cartão", aí a opção existe só enquanto esse filtro estiver ativo
  const connected = connectedBanks().filter(i => i.type !== "CREDIT" || i.id === txFilterBanco);
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    connected.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  bancoSel.value = txFilterBanco;
  document.getElementById("tx-filter-tipo").value = txFilterTipo;

  const catSel = document.getElementById("tx-filter-categoria");
  catSel.innerHTML = `<option value="all">Todas categorias</option>` +
    allCategories().map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
  catSel.value = txFilterCategoria;
}

function renderTransacoes() {
  populateTxFilters();
  renderTxReviewBanner();
  const allTxs = filterTx(state.transactions, { range: periodRange(txFilterPeriodo), banco: txFilterBanco, tipo: txFilterTipo, categoria: txFilterCategoria, search: txSearch })
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
  const info = instInfo(t.bank_id, t.account_name);
  const cat = catInfo(effectiveCategory(t));
  const isPos = t.value >= 0;
  return `<div class="tx-row" data-tx-id="${t.id}">
    <div class="tx-row-left">
      ${bankLogo("tx-icon", info.logoName || info.name, info.color, t.desc)}
      <div>
        <div class="tx-desc">${esc(t.desc)}</div>
        <div class="tx-meta">
          <span class="tx-bank-name">${esc(info.name)}</span>
          <span class="tx-cat-chip"${isGuess(t) ? ' title="Sugerida pela IA — toque na transação para confirmar ou corrigir"' : ""}>${cat.icon} ${cat.name}${isGuess(t) ? " ✨" : ""}</span>
        </div>
      </div>
    </div>
    <div class="tx-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
  </div>`;
}

function openTxDetalhe(id) {
  const t = state.transactions.find(x => x.id === Number(id));
  if (!t) return;
  const info = instInfo(t.bank_id, t.account_name);
  const cat = catInfo(effectiveCategory(t));
  const isPos = t.value >= 0;
  const dateFmt = t.date.split("-").reverse().join("/");
  document.getElementById("detalhe-body").innerHTML = `
    <div class="detalhe-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
    <div style="font-weight:700;font-size:15px">${esc(t.desc)}</div>
    <div class="detalhe-cat-badge">${cat.icon} ${cat.name}</div>
    <div class="detalhe-info-row"><span>Categoria definida por</span><span>${sourceLabel(t)}</span></div>
    <div class="detalhe-info-row"><span>Banco</span><span>${esc(info.name)}</span></div>
    <div class="detalhe-info-row"><span>Data</span><span>${dateFmt}</span></div>
    <div class="detalhe-info-row"><span>Tipo</span><span>${isPos ? "Entrada" : "Saída"}</span></div>
    <div class="detalhe-info-row"><span>Origem</span><span>${isPluggyBank(t.bank_id) ? "Open Finance (real)" : "Manual"}</span></div>
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
  const cats = allCategories().filter(c => c.id !== "salario" || (t && t.type === "entrada"));
  grid.innerHTML = cats.map(c => `
    <div class="cat-grid-item ${c.id === pendingCatSelected ? "selected" : ""}" data-cat-id="${c.id}">
      ${c.id !== "outros" && c.id !== "nao_identificada" ? `
        <div class="cat-grid-actions">
          <button type="button" class="cat-mini-btn" data-edit-cat="${c.id}" title="Editar categoria">✎</button>
          <button type="button" class="cat-mini-btn cat-mini-btn-danger" data-del-cat="${c.id}" title="Excluir categoria">🗑</button>
        </div>
      ` : ""}
      <div class="cat-icon" style="background:${c.color}">${c.icon}</div>
      ${c.name}
    </div>
  `).join("") + `
    <div class="cat-grid-item cat-grid-add" id="cat-grid-add-btn">
      <div class="cat-icon cat-icon-add">+</div>
      Nova categoria
    </div>
  `;
  openModal("modal-categoria");
}
async function saveCategoria() {
  if (pendingCatTxId == null || !pendingCatSelected) return;
  const r = await api(`/transactions/${pendingCatTxId}/category`, { method: "PUT", body: { category: pendingCatSelected } });
  await refreshTransactions();
  closeAllModals();
  renderScreen(currentScreen);
  if (r && r.applied) showToast(`Pronto! Também apliquei essa categoria em ${r.applied} transaç${r.applied === 1 ? "ão parecida" : "ões parecidas"}.`);
}


/* ============================================================
   REVISÃO DE CATEGORIAS
   - Aviso automático: depois de ~1 mês sem abrir o app, pergunta
     "vamos revisar as categorias dessas transações?" (só as novas
     desde a última visita).
   - Faixa na tela de Transações: revisar as "sem categoria".
   Teste rápido: abra o app com ?revisar na URL para forçar o aviso.
   ============================================================ */
const REVIEW_GAP_DAYS = 30;
const REVIEW_MAX = 30;
const LAST_VISIT_KEY = "fh_last_visit";
let reviewChecked = false;
let review = { ids: [], pos: 0, done: 0, note: "" };

function descKey(desc) {
  return String(desc || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1 && !/\d/.test(w)).slice(0, 3).join(" ");
}
function renderTxReviewBanner() {
  const el = document.getElementById("tx-review-banner");
  if (!el) return;
  const sem = state.transactions.filter(t => t.category === "nao_identificada").length;
  const chutes = state.transactions.filter(t => isGuess(t) && !Number(t.category_manual)).length;
  if (!sem && !chutes) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const partes = [];
  if (sem) partes.push(`❓ <b>${sem}</b> sem categoria`);
  if (chutes) partes.push(`✨ <b>${chutes}</b> sugerida${chutes === 1 ? "" : "s"} pela IA`);
  el.classList.remove("hidden");
  el.innerHTML = `<span>${partes.join(" • ")}</span><button type="button" id="btn-open-revisao">Revisar</button>`;
}
function openReviewIntro(days, novas, semCat) {
  document.getElementById("revisao-title").textContent = "Vamos revisar?";
  document.getElementById("revisao-body").innerHTML = `
    <div class="rev-intro">
      <div class="rev-emoji">👋</div>
      <strong style="font-size:16px;color:var(--navy)">Faz ${days} dias que você não entra por aqui</strong>
      <p>Chegaram <strong>${novas}</strong> transaç${novas === 1 ? "ão nova" : "ões novas"} nesse tempo${semCat ? ` (${semCat} sem categoria)` : ""}.<br>Vamos revisar as categorias dessas transações?</p>
    </div>
    <div class="rev-actions">
      <button class="btn btn-outline" type="button" data-rev="close">Agora não</button>
      <button class="btn btn-primary" type="button" data-rev="start">Vamos!</button>
    </div>`;
  openModal("modal-revisao");
}
function startReview(ids) {
  review = { ids, pos: 0, done: 0, note: "" };
  document.getElementById("revisao-title").textContent = "Revisar categorias";
  openModal("modal-revisao");
  renderReviewStep();
}
function startUnidentifiedReview() {
  const pend = state.transactions.filter(needsReview);
  // sem categoria primeiro; dentro disso, agrupa por estabelecimento parecido (uma resposta já resolve várias, o servidor aprende)
  const freq = {};
  pend.forEach(t => { const k = descKey(t.desc); freq[k] = (freq[k] || 0) + 1; });
  pend.sort((a, b) => (Number(b.category === "nao_identificada") - Number(a.category === "nao_identificada")) ||
    (freq[descKey(b.desc)] - freq[descKey(a.desc)]) || (Math.abs(b.value) - Math.abs(a.value)));
  startReview(pend.slice(0, REVIEW_MAX).map(t => t.id));
}
function renderReviewStep() {
  const body = document.getElementById("revisao-body");
  // pula as que já foram resolvidas sozinhas pelo aprendizado
  while (review.pos < review.ids.length) {
    const t = state.transactions.find(x => x.id === review.ids[review.pos]);
    if (t) break;
    review.pos++;
  }
  if (review.pos >= review.ids.length) {
    body.innerHTML = `
      <div class="rev-intro">
        <div class="rev-emoji">🎉</div>
        <strong style="font-size:16px;color:var(--navy)">Revisão concluída!</strong>
        <p>${review.done ? `Você categorizou ${review.done} transaç${review.done === 1 ? "ão" : "ões"}.` : "Nada alterado."}${review.note ? `<br>${review.note}` : ""}</p>
      </div>
      <div class="rev-actions"><button class="btn btn-primary" type="button" data-rev="close">Fechar</button></div>`;
    return;
  }
  const t = state.transactions.find(x => x.id === review.ids[review.pos]);
  const info = instInfo(t.bank_id);
  const cur = catInfo(t.category);
  const isPos = t.value >= 0;
  const total = review.ids.length;
  const cats = CATEGORIES.filter(c => c.id !== "nao_identificada" && (c.id !== "salario" || t.type === "entrada"));
  body.innerHTML = `
    <div class="rev-progress"><span>${review.pos + 1} de ${total}</span><span>${cur.icon} ${cur.name}${isGuess(t) ? " ✨ sugerida" : ""}</span></div>
    <div class="rev-bar"><i style="width:${Math.round((review.pos / total) * 100)}%"></i></div>
    ${review.note ? `<div class="rev-note">${esc(review.note)}</div>` : ""}
    <div class="rev-tx">
      <div class="rev-desc">${esc(t.desc)}</div>
      <div class="rev-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
      <div class="rev-meta">${fmtDate(t.date) || ""} • ${esc(info.name)}</div>
    </div>
    <div class="cat-grid" id="rev-grid">
      ${cats.map(c => `<div class="cat-grid-item ${c.id === t.category ? "selected" : ""}" data-rev-cat="${c.id}"><div class="cat-icon" style="background:${c.color}">${c.icon}</div>${c.name}</div>`).join("")}
      <div class="cat-grid-item cat-grid-add" id="rev-grid-add-btn">
        <div class="cat-icon cat-icon-add">+</div>
        Nova categoria
      </div>
    </div>
    <div class="rev-actions">
      ${t.category === "nao_identificada"
        ? `<button class="btn btn-outline" type="button" data-rev="skip">Pular</button>`
        : `<button class="btn btn-primary" type="button" data-rev="confirm">✓ Está certo</button>`}
    </div>`;
}
async function reviewPick(catId) {
  const id = review.ids[review.pos];
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  review.note = "";
  try {
    if (catId !== t.category || !Number(t.category_manual)) {
      const r = await api(`/transactions/${id}/category`, { method: "PUT", body: { category: catId } });
      review.done++;
      review.note = r && r.applied ? `✓ Salvo — apliquei em mais ${r.applied} parecida${r.applied === 1 ? "" : "s"}` : "✓ Salvo";
      await refreshTransactions();
      renderScreen(currentScreen);
    }
  } catch (e) { review.note = "Não consegui salvar: " + e.message; renderReviewStep(); return; }
  review.pos++;
  renderReviewStep();
}
async function checkReviewPrompt() {
  if (reviewChecked) return;
  reviewChecked = true;
  const force = new URLSearchParams(location.search).has("revisar");
  let previous = null;
  try { previous = (await api("/me/visit", { method: "POST" })).previous; }
  catch (e) { previous = localStorage.getItem(LAST_VISIT_KEY); }
  localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());

  let prevDate = previous ? new Date(previous) : null;
  if (prevDate && isNaN(prevDate)) prevDate = null;
  if (!prevDate && force) prevDate = new Date(Date.now() - REVIEW_GAP_DAYS * 864e5);
  if (!prevDate) return; // primeira vez: nada para revisar
  const days = Math.floor((Date.now() - prevDate.getTime()) / 864e5);
  if (days < REVIEW_GAP_DAYS && !force) return;

  const prevYmd = ymdLocal(prevDate);
  const novas = state.transactions.filter(t => t.date > prevYmd || (parseDbDate(t.created_at) && parseDbDate(t.created_at) > prevDate));
  if (!novas.length) return;
  // sem categoria primeiro, depois as mais recentes
  novas.sort((a, b) => (Number(b.category === "nao_identificada") - Number(a.category === "nao_identificada")) || b.date.localeCompare(a.date));
  review = { ids: novas.slice(0, REVIEW_MAX).map(t => t.id), pos: 0, done: 0, note: "" };
  openReviewIntro(Math.max(days, REVIEW_GAP_DAYS), novas.length, novas.filter(t => t.category === "nao_identificada").length);
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
  drawDonut("cat-donut", byCat, total, catSegment === "gastos" ? "em gastos" : "em ganhos");
  renderLegend("cat-legend", byCat, total);
  const el = document.getElementById("categorias-list");
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">Nenhuma transação nesta categoria.</div>`;
    return;
  }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? ((val/total)*100).toFixed(1) : "0.0";
    return `<div class="cat-row" data-cat="${cat}">
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

function openNovaCategoriaModal(editId) {
  editingCatId = editId || null;
  const titleEl = document.querySelector("#modal-nova-categoria h3");
  const btnEl = document.getElementById("btn-salvar-nova-categoria");
  if (editingCatId) {
    const c = allCategories().find(x => x.id === editingCatId);
    titleEl.textContent = "Editar categoria";
    btnEl.textContent = "Salvar alterações";
    document.getElementById("input-nova-cat-nome").value = c ? c.name : "";
    document.getElementById("input-nova-cat-emoji").value = c ? c.icon : "";
  } else {
    titleEl.textContent = "Nova categoria";
    btnEl.textContent = "Criar categoria";
    document.getElementById("input-nova-cat-nome").value = "";
    document.getElementById("input-nova-cat-emoji").value = "";
  }
  document.getElementById("nova-cat-error").classList.add("hidden");
  openModal("modal-nova-categoria");
}
async function saveNovaCategoria() {
  const nome = document.getElementById("input-nova-cat-nome").value.trim();
  const emoji = document.getElementById("input-nova-cat-emoji").value.trim();
  const errEl = document.getElementById("nova-cat-error");
  errEl.classList.add("hidden");
  if (!nome || !emoji) {
    errEl.textContent = "Escolha um emoji e um nome para a categoria.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    if (editingCatId) {
      await api(`/categories/${editingCatId}`, { method: "PUT", body: { name: nome, icon: emoji } });
    } else {
      await api("/categories", { method: "POST", body: { name: nome, icon: emoji } });
    }
    editingCatId = null;
    await refreshCategories();
    await refreshTransactions();
    closeAllModals();
    if (novaCatOrigin === "review") {
      novaCatOrigin = null;
      openModal("modal-revisao");
      renderReviewStep();
    } else if (pendingCatTxId != null) {
      openCategoriaModal(pendingCatTxId);
    } else {
      renderScreen(currentScreen);
    }
  } catch (e) {
    errEl.textContent = e.message || "Não foi possível salvar a categoria.";
    errEl.classList.remove("hidden");
  }
}
async function deleteCategoria(id) {
  const c = allCategories().find(x => x.id === id);
  if (!confirm(`Excluir a categoria "${c ? c.name : id}"? As transações dela passam para "Outros".`)) return;
  try {
    await api(`/categories/${id}`, { method: "DELETE" });
    await refreshCategories();
    await refreshTransactions();
    if (pendingCatSelected === id) pendingCatSelected = "outros";
    if (pendingCatTxId != null) openCategoriaModal(pendingCatTxId);
    else renderScreen(currentScreen);
  } catch (e) {
    alert(e.message || "Não foi possível excluir a categoria.");
  }
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
  const prevMes = mesSel.value;
  mesSel.innerHTML = `<option value="all">Ano inteiro</option>` + MONTH_NAMES.map((m,i) => `<option value="${i}">${m}</option>`).join("");
  mesSel.value = prevMes || String(new Date().getMonth());

  const bancoSel = document.getElementById("rel-banco");
  const connected = connectedBanks();
  bancoSel.innerHTML = `<option value="all">Todos</option>` + bankAccountsOnly().map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("");

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
    if (banco === "all" && isCreditTx(t)) return false; // cartão fica de fora dos totais gerais
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
  const sobra = entradas - saidas;
  document.getElementById("rel-resultado").textContent = fmtBRL(Math.abs(sobra));
  document.getElementById("rel-res-label").textContent = sobra >= 0 ? "Sobrou" : "Faltou";
  document.getElementById("rel-resultado").style.color = sobra >= 0 ? "var(--green)" : "var(--out)";
  document.getElementById("rel-frase").textContent = txs.length
    ? `Entrou ${fmtBRL(entradas)} e saiu ${fmtBRL(saidas)}. ${sobra >= 0 ? "Sobrou" : "Faltou"} ${fmtBRL(Math.abs(sobra))} no período.`
    : "Nenhuma transação neste período.";

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
    return `<div class="bank-line-row"><span>${esc(i.name)}</span><span>${fmtBRL(val)}</span></div>`;
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
  const redColor = themeColor("--out") || "#E5484D";
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
  const verbo = tipo === "saida" ? "gastou" : "recebeu";
  if (m1 === m2) { el.innerHTML = `<div class="empty-state">Escolha dois meses diferentes para comparar.</div>`; return; }
  el.innerHTML = v1 === 0 && v2 === 0
    ? `<div class="empty-state">Sem dados nesses dois meses.</div>`
    : `<div class="comp-diff ${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "↑" : "↓"} ${fmtBRL(Math.abs(diff))} ${diff >= 0 ? "a mais" : "a menos"}</div>
       <p class="rel-frase">Em ${monthLabel(m2)} você ${verbo} ${fmtBRL(v2)}. Em ${monthLabel(m1)} foram ${fmtBRL(v1)}${v1 ? ` (${Math.abs(pct)}% ${diff >= 0 ? "a mais" : "a menos"})` : ""}.</p>`;
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(id) { closeAllModals(); document.getElementById(id).classList.add("active"); }

// Aviso não-bloqueante no rodapé da tela. Diferente de alert(), não trava a thread —
// então a tela já mostra os dados atualizados por trás dele (ex: contas recém-sincronizadas).
let toastTimer = null;
function showToast(msg, { error = false, ms = 5000 } = {}) {
  const el = document.getElementById("toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.classList.toggle("toast-error", error);
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
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
  state.user = null; state.transactions = []; state.accounts = []; state.pluggyItems = [];
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
      theme: "outline", size: "large", width: 340, shape: "pill", text: "continue_with"
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
  renderAccentPicker(); renderNavEditor();
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
  el.innerHTML = state.pluggyItems.map(p => {
    const accs = state.accounts.filter(a => a.item_id === p.item_id);
    const bankNames = accs.filter(a => a.type !== "CREDIT").map(a => prettyName(a.name));
    const title = bankNames.length ? bankNames.join(" • ") : (accs.length ? accs.map(a => accountLabel(a)).join(" • ") : (p.institution_name || "Conta conectada"));
    const accsHtml = accs.length ? accs.map(a => {
      const isCard = a.type === "CREDIT";
      const val = isCard ? cardUsed(a) : num(a.balance);
      return `<div class="inst-acc">
        ${bankLogo("bank-avatar", title, pluggyColorFor(a.account_id), accountLabel(a))}
        <div class="inst-acc-info">
          <div class="inst-acc-name">${esc(accountLabel(a))}</div>
          <div class="inst-acc-sub">${esc(accountTypeLabel(a))}${a.data?.number ? ` • final ${esc(a.data.number)}` : ""}</div>
        </div>
        <div class="inst-acc-value">
          <div class="inst-acc-amount">${val !== null ? fmtBRL(val) : "—"}</div>
          <div class="inst-acc-label">${isCard ? "Limite usado" : "Saldo"}</div>
        </div>
      </div>`;
    }).join("") : `<div class="inst-empty">Nenhuma conta carregada ainda. Clique em Sincronizar.</div>`;
    return `<div class="inst-conn">
      <div class="inst-conn-head">
        <div class="inst-conn-info">
          <div class="inst-conn-title">${esc(title)}</div>
          <div class="bank-status connected"><span class="dot-status"></span>Conectado via ${esc(p.institution_name || "Pluggy")}</div>
          <div class="inst-conn-sub">CPF ${esc(maskCpf(p.cpf))} • última sinc.: ${esc(fmtDateTime(p.last_sync))}</div>
        </div>
        <div class="inst-conn-actions">
          <button class="btn-connect connected" data-pluggy-sync="${esc(p.item_id)}">Sincronizar</button>
          <button class="btn-connect danger" data-pluggy-remove="${esc(p.id)}">Remover</button>
        </div>
      </div>
      <div class="inst-accs">${accsHtml}</div>
    </div>`;
  }).join("");
}
function maskCpf(cpf) {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0,3)}.***.**${digits.slice(9,11) ? "*-" + digits.slice(9,11) : ""}`;
}

let pluggyPendingCpf = null;

function openPluggyCpfModal() {
  const cpfInput = document.getElementById("input-pluggy-cpf");
  cpfInput.value = "";
  document.getElementById("pluggy-error").classList.add("hidden");
  openModal("modal-pluggy-cpf");
}

// Formata o CPF enquanto o usuário digita: 000.000.000-00
function formatCpfInput(el) {
  let digits = el.value.replace(/\D/g, "").slice(0, 11);
  let out = digits.slice(0, 3);
  if (digits.length > 3) out += "." + digits.slice(3, 6);
  if (digits.length > 6) out += "." + digits.slice(6, 9);
  if (digits.length > 9) out += "-" + digits.slice(9, 11);
  el.value = out;
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

  // bolinhas no botão principal enquanto o servidor gera o token (na primeira vez pode demorar)
  await withLoading(document.getElementById("btn-pluggy-connect"), async () => {
    try {
      const { connectToken } = await api("/pluggy/connect-token", { method: "POST" });
      const pluggyConnect = new PluggyConnect({
        connectToken,
        includeSandbox: false, // false = só conectores reais (MeuPluggy e bancos); true mostra os bancos fake de teste
        onSuccess: async (itemData) => {
          showScreenLoader();
          try {
            await api("/pluggy/items", {
              method: "POST",
              body: {
                itemId: itemData.item.id,
                cpf: pluggyPendingCpf,
                institutionName: itemData.item.connector?.name || "Conta conectada"
              }
            });
            // logo após conectar, o Pluggy pode levar alguns segundos para deixar as contas
            // prontas (status "UPDATING"). O servidor já espera um pouco, mas se ainda assim
            // vier vazio, tenta de novo silenciosamente antes de desistir e mostrar "conectado".
            let r = await api(`/pluggy/sync/${itemData.item.id}`, { method: "POST" });
            for (let tent = 0; !r.contasEncontradas && tent < 3; tent++) {
              await new Promise(res => setTimeout(res, 3000));
              try { r = await api(`/pluggy/sync/${itemData.item.id}`, { method: "POST" }); }
              catch (e) { break; }
            }
            await refreshAfterSync();
            if (!r.contasEncontradas) {
              showToast("Conectado! O banco ainda está processando as contas — toque em \"Sincronizar\" em Meus bancos daqui a um minuto se elas não aparecerem sozinhas.");
            } else {
              showToast(`Conectado! ${r.contasEncontradas} conta${r.contasEncontradas === 1 ? "" : "s"} encontrada${r.contasEncontradas === 1 ? "" : "s"}.`);
            }
          } catch (e) {
            showToast("Conectado, mas houve um erro ao salvar/sincronizar: " + e.message, { error: true });
          } finally {
            hideScreenLoader();
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
  });
}

const syncingNow = new Set();
async function refreshAfterSync() {
  await Promise.all([refreshTransactions(), refreshAccounts(), refreshPluggyItems(), refreshInvestments()]);
  renderScreen(currentScreen);
}
async function syncPluggyItem(itemId, { quiet = false } = {}) {
  if (syncingNow.has(itemId)) return null;
  syncingNow.add(itemId);
  try {
    const r = await api(`/pluggy/sync/${itemId}`, { method: "POST" });
    if (!quiet) {
      await refreshAfterSync();
      let msg = `Sincronizado! ${r.novas ?? 0} novas • ${r.contasEncontradas} conta${r.contasEncontradas === 1 ? "" : "s"} encontrada${r.contasEncontradas === 1 ? "" : "s"}.`;
      if (!r.contasEncontradas) {
        msg = r.item?.status === "UPDATING"
          ? "O banco ainda está processando essa conexão. Espera um minuto e toca em Sincronizar de novo."
          : `O Pluggy não devolveu nenhuma conta ainda.${r.item?.erro ? " Erro: " + r.item.erro : ""}`;
      }
      showToast(msg, { error: !r.contasEncontradas });
    }
    return r;
  } catch (e) {
    if (!quiet) showToast("Erro ao sincronizar: " + e.message, { error: true });
    return null;
  } finally { syncingNow.delete(itemId); }
}
// Sincroniza todos os bancos, um de cada vez (evita um banco atropelar o outro)
async function syncAllPluggy({ quiet = false } = {}) {
  const items = [...(state.pluggyItems || [])];
  if (!items.length) { if (!quiet) showToast("Nenhum banco conectado ainda."); return; }
  let novas = 0, falhas = 0;
  for (const it of items) {
    const r = await syncPluggyItem(it.item_id, { quiet: true });
    if (r) novas += r.novas || 0; else falhas++;
  }
  localStorage.setItem("lastAutoSync", String(Date.now()));
  await refreshAfterSync();
  if (!quiet) showToast(falhas ? `Sincronizado com ${falhas} falha${falhas === 1 ? "" : "s"}. Tente de novo nos bancos que não atualizaram.` : `Tudo sincronizado! ${novas} nova${novas === 1 ? "" : "s"} transaç${novas === 1 ? "ão" : "ões"}.`, { error: !!falhas });
}
// Ao abrir o app (e ao voltar para ele), atualiza sozinho se faz mais de 10 minutos
let autoSyncing = false;
async function autoSyncAll() {
  if (autoSyncing || !state.user || !(state.pluggyItems || []).length) return;
  if (Date.now() - Number(localStorage.getItem("lastAutoSync") || 0) < 10 * 60 * 1000) return;
  autoSyncing = true; showScreenLoader();
  try { await syncAllPluggy({ quiet: true }); } finally { autoSyncing = false; hideScreenLoader(); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoSyncAll(); });

async function removePluggyItem(id) {
  if (!confirm("Remover esta conexão? As transações dela também serão apagadas do app.")) return;
  try {
    await api(`/pluggy/items/${id}`, { method: "DELETE" });
    await Promise.all([refreshPluggyItems(), refreshTransactions(), refreshAccounts()]);
    renderScreen(currentScreen);
  } catch (e) {
    alert("Erro ao remover: " + e.message);
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wire(fn, label) {
  try { fn(); } catch (err) { console.error(`Fluxo: falha ao configurar "${label}"`, err); }
}

initTheme();

/* ---------- PWA: instalar no celular ---------- */
let deferredInstall = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredInstall = e;
  document.getElementById("btn-install")?.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => { deferredInstall = null; document.getElementById("btn-install")?.classList.add("hidden"); });
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-install");
  if (!btn || isStandalone()) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) document.getElementById("install-hint")?.classList.remove("hidden");
  btn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null; btn.classList.add("hidden");
  });
});

document.addEventListener("DOMContentLoaded", () => {

  wire(() => {
    document.getElementById("btn-email-login").addEventListener("click", () => { setAuthMode("login"); openModal("modal-email"); });
    document.getElementById("link-create-account").addEventListener("click", (e) => { e.preventDefault(); setAuthMode("register"); openModal("modal-email"); });
    document.getElementById("btn-do-email-login").addEventListener("click", (e) => withLoading(e.currentTarget, async () => {
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
    }));
  }, "login por e-mail");

  wire(() => {
    document.getElementById("btn-profile").addEventListener("click", () => openModal("modal-perfil"));
    document.getElementById("btn-logout").addEventListener("click", logoutUser);
    document.getElementById("btn-ajuda").addEventListener("click", () => alert("Precisa de ajuda? Fale com o suporte pelo e-mail eduardo8528233@gmail.com"));
    document.getElementById("btn-configuracoes").addEventListener("click", openConfiguracoes);
  }, "perfil");

  wire(() => {
    document.getElementById("cfg-modo-escuro").addEventListener("change", toggleTheme);
    document.getElementById("btn-salvar-config").addEventListener("click", (e) => withLoading(e.currentTarget, saveConfiguracoes));
  }, "configurações");

  wire(() => {
    document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);
  }, "tema");

  wire(() => {
    renderBottomNav(); wireNavEditor();
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
    document.getElementById("btn-hide-values").addEventListener("click", toggleHideValues);
    applyHideUI();
    document.getElementById("btn-ver-entradas").addEventListener("click", () => openEntradasSaidas("entrada"));
    document.getElementById("btn-ver-saidas").addEventListener("click", () => openEntradasSaidas("saida"));
  }, "filtros do dashboard");

  wire(() => {
    document.getElementById("btn-back").addEventListener("click", () => navigateTo(currentScreen === "categoria-detalhe" ? "categorias" : "inicio", { refresh: false }));
    document.getElementById("catdet-container").addEventListener("click", (e) => {
      const row = e.target.closest("[data-tx-id]");
      if (row) openTxDetalhe(row.dataset.txId);
    });
    document.getElementById("inv-list").addEventListener("click", (e) => {
      const r = e.target.closest(".inv-edit-date");
      if (r) editInvDate(r.dataset.invId, r.dataset.date);
    });
    const openCat = (e) => { const r = e.target.closest("[data-cat]"); if (r) openCategoriaDetalhe(r.dataset.cat); };
    document.getElementById("categorias-list").addEventListener("click", openCat);
    document.getElementById("cat-legend").addEventListener("click", openCat);
    document.getElementById("es-list-container").addEventListener("click", (e) => {
      const row = e.target.closest("[data-tx-id]");
      if (row) openTxDetalhe(row.dataset.txId);
    });
  }, "entradas/saídas");

  wire(() => {
    document.getElementById("btn-pluggy-connect").addEventListener("click", openPluggyCpfModal);
    document.getElementById("input-pluggy-cpf").addEventListener("input", (e) => formatCpfInput(e.target));
    document.getElementById("btn-pluggy-continuar").addEventListener("click", startPluggyConnect);
    document.getElementById("btn-sync-all")?.addEventListener("click", (e) => withLoading(e.currentTarget, () => syncAllPluggy(), { minMs: 0 }));
    document.getElementById("pluggy-items-list").addEventListener("click", (e) => {
      const syncBtn = e.target.closest("[data-pluggy-sync]");
      const removeBtn = e.target.closest("[data-pluggy-remove]");
      if (syncBtn) withLoading(syncBtn, () => syncPluggyItem(syncBtn.dataset.pluggySync), { minMs: 0 });
      if (removeBtn) withLoading(removeBtn, () => removePluggyItem(removeBtn.dataset.pluggyRemove));
    });
    document.getElementById("cards-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-card-tx]");
      if (!b) return;
      txFilterBanco = b.dataset.cardTx; txVisibleCount = TX_PAGE_SIZE;
      navigateTo("transacoes");
    });
  }, "pluggy");

  wire(() => {
    document.getElementById("btn-toggle-filtros").addEventListener("click", (e) => {
      populateTxFilters();
      openModal("modal-filtros");
    });
    document.getElementById("btn-aplicar-filtros").addEventListener("click", () => closeAllModals());
    document.getElementById("btn-limpar-filtros").addEventListener("click", () => {
      txFilterPeriodo = "all"; txFilterBanco = "all"; txFilterTipo = "all"; txFilterCategoria = "all";
      txVisibleCount = TX_PAGE_SIZE;
      populateTxFilters();
      renderTransacoes();
    });
    document.getElementById("search-transacoes").addEventListener("input", (e) => { txSearch = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-periodo").addEventListener("change", (e) => { txFilterPeriodo = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
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
      if (excluirBtn) { if (confirm("Excluir esta transação?")) withLoading(excluirBtn, () => deleteTx(excluirBtn.dataset.txId)); }
    });
    document.getElementById("cat-grid").addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-cat]");
      const delBtn = e.target.closest("[data-del-cat]");
      const addBtn = e.target.closest("#cat-grid-add-btn");
      if (editBtn) { novaCatOrigin = null; openNovaCategoriaModal(editBtn.dataset.editCat); return; }
      if (delBtn) { deleteCategoria(delBtn.dataset.delCat); return; }
      if (addBtn) { novaCatOrigin = null; openNovaCategoriaModal(null); return; }
      const item = e.target.closest("[data-cat-id]");
      if (!item) return;
      pendingCatSelected = item.dataset.catId;
      document.querySelectorAll("#cat-grid .cat-grid-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
    });
    document.getElementById("btn-salvar-categoria").addEventListener("click", (e) => withLoading(e.currentTarget, saveCategoria));
    document.getElementById("tx-review-banner").addEventListener("click", (e) => { if (e.target.closest("#btn-open-revisao")) startUnidentifiedReview(); });
    document.getElementById("revisao-body").addEventListener("click", (e) => {
      const addBtn = e.target.closest("#rev-grid-add-btn");
      if (addBtn) { novaCatOrigin = "review"; openNovaCategoriaModal(null); return; }
      const cat = e.target.closest("[data-rev-cat]");
      if (cat) return reviewPick(cat.dataset.revCat);
      const act = e.target.closest("[data-rev]");
      if (!act) return;
      if (act.dataset.rev === "close") { closeAllModals(); renderScreen(currentScreen); }
      if (act.dataset.rev === "start") startReview(review.ids);
      if (act.dataset.rev === "skip") { review.note = ""; review.pos++; renderReviewStep(); }
      if (act.dataset.rev === "confirm") { const cur = state.transactions.find(x => x.id === review.ids[review.pos]); if (cur) reviewPick(cur.category); }
    });
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
    const EMOJI_SUGGESTIONS = ["🐾","🏠","🎁","🧴","🎮","📱","💇","🧾","🎵","🧸","⚽","🌱"];
    document.getElementById("emoji-suggestions").innerHTML =
      EMOJI_SUGGESTIONS.map(em => `<button type="button" data-emoji="${em}">${em}</button>`).join("");
    document.getElementById("btn-nova-categoria").addEventListener("click", (e) => {
      e.preventDefault();
      pendingCatTxId = null;
      novaCatOrigin = null;
      openNovaCategoriaModal(null);
    });
    document.getElementById("emoji-suggestions").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-emoji]");
      if (btn) document.getElementById("input-nova-cat-emoji").value = btn.dataset.emoji;
    });
    document.getElementById("btn-salvar-nova-categoria").addEventListener("click", (e) => withLoading(e.currentTarget, saveNovaCategoria));
  }, "nova categoria");

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
    ["comp-mes1","comp-mes2","comp-tipo"].forEach(id => document.getElementById(id).addEventListener("change", renderComparacao));
    document.getElementById("rel-segmented").addEventListener("click", () => { if (relSegment === "comparar") renderComparacao(); });
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
