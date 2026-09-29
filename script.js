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
// Os valores só "sobem" do zero na 1ª abertura do app; depois disso aparecem já certos (sem animar a cada troca de tela)
let introAnim = true;
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
// Ícones de interface em SVG (o app não usa emojis fora das categorias)
const SVG_BASE = 'width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON = (paths, s = 16) => `<svg ${SVG_BASE.replace(/\{s\}/g, s)}>${paths}</svg>`;
const ICONS = {
  pencil: (s) => ICON('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>', s),
  trash:  (s) => ICON('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>', s),
  grip:   (s) => ICON('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>', s),
  eye:    (s) => ICON('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', s),
  eyeOff: (s) => ICON('<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.6 7 10 7a10 10 0 004.4-1"/>', s),
  list:   (s) => ICON('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>', s),
  check:  (s) => ICON('<path d="M5 12l4 4 10-10"/>', s),
  refresh:(s) => ICON('<path d="M20 11a8 8 0 00-14.5-4M4 5v4h4M4 13a8 8 0 0014.5 4M20 19v-4h-4"/>', s),
  chevron:(s) => ICON('<path d="M9 6l6 6-6 6"/>', s),
  arrowDown:(s) => ICON('<path d="M12 5v14M6 13l6 6 6-6"/>', s),
  arrowUp:(s) => ICON('<path d="M12 19V5M6 11l6-6 6 6"/>', s),
  clock:  (s) => ICON('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  tag:    (s) => ICON('<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1"/>', s)
};
function initials(name) { return esc(String(name || "").split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// Só troca o conteúdo de um <select> se as opções mudaram (antes recriava tudo a cada tela desenhada)
function setSelect(sel, html, value) {
  if (!sel) return;
  if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  if (sel.value !== value) sel.value = value;
}
// Valor que "conta" até o número novo (respeita valores escondidos e "reduzir movimento")
function countTo(el, to, { fmt = fmtBRL, html = false, ms = 650 } = {}) {
  if (!el) return;
  const prop = html ? "innerHTML" : "textContent";
  const from = el.dataset.v === undefined ? 0 : Number(el.dataset.v);
  el.dataset.v = String(to);
  cancelAnimationFrame(el._raf);
  if (!introAnim || valuesHidden() || REDUCE_MOTION || !isFinite(from) || from === to) { el[prop] = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    el[prop] = fmt(t < 1 ? from + (to - from) * easeOutCubic(t) : to);
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
// Ordenação por valor: um botão só que alterna Mais recentes → Maior valor → Menor valor
const SORT_CYCLE = ["recent", "high", "low"];
const SORT_LABEL = { recent: "Mais recentes", high: "Maior valor", low: "Menor valor" };
function sortTxs(list, mode) {
  const a = list.slice();
  if (mode === "high") return a.sort((x, y) => Math.abs(y.value) - Math.abs(x.value) || y.date.localeCompare(x.date));
  if (mode === "low") return a.sort((x, y) => Math.abs(x.value) - Math.abs(y.value) || y.date.localeCompare(x.date));
  return a.sort((x, y) => y.date.localeCompare(x.date) || (Number(y.id) - Number(x.id)));
}
function sortBtnHtml(key) {
  const m = sortMode[key];
  const icon = m === "high" ? ICONS.arrowDown(15) : m === "low" ? ICONS.arrowUp(15) : ICONS.clock(15);
  return `<div class="sort-row"><button type="button" class="sort-btn${m === "recent" ? "" : " active"}" data-sort="${key}" aria-label="Ordenação: ${SORT_LABEL[m]}. Toque para alternar">${icon}<span>${SORT_LABEL[m]}</span></button></div>`;
}
function renderSortSlot(id, key) {
  const slot = document.getElementById(id); if (!slot) return;
  if (slot.dataset.m !== sortMode[key]) { slot.innerHTML = sortBtnHtml(key); slot.dataset.m = sortMode[key]; }
}
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
const SPINNER_SM = `<span class="ring-spinner" aria-hidden="true"></span>`;
const MIN_BTN_SPIN_MS = 300;
const DATA_TTL_MS = 60000; // dados em memória valem 1 minuto antes de buscar de novo no servidor

// Mostra um anel girando no botão enquanto a ação roda (mínimo de 0,3 s) e bloqueia clique duplo.
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
// A barrinha de carregamento nunca fica para sempre: se algo travar, some sozinha depois de 20 s.
let loaderWatchdog = null;
let loaderCount = 0;
function showScreenLoader() {
  loaderCount++;
  document.getElementById("screen-loader")?.classList.add("show");
  clearTimeout(loaderWatchdog);
  loaderWatchdog = setTimeout(() => hideScreenLoader(true), 20000);
}
function hideScreenLoader(force) {
  loaderCount = force ? 0 : Math.max(0, loaderCount - 1);
  if (loaderCount > 0) return;
  clearTimeout(loaderWatchdog);
  document.getElementById("screen-loader")?.classList.remove("show");
}
// Barrinha rápida a cada troca de tela: dá tempo dos valores "subirem" e mostra que o app está trabalhando.
function flashLoader(ms = 520) { showScreenLoader(); setTimeout(() => hideScreenLoader(), ms); }
const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ============================================================
   CAMADA DE API
   ============================================================ */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

// Toda chamada ao servidor tem tempo limite. Antes, se o servidor demorasse ou caísse, a chamada nunca
// terminava e as bolinhas giravam para sempre. O servidor gratuito "dorme" e pode levar ~1 min para acordar.
const API_TIMEOUT_MS = 45000;
async function api(path, { method = "GET", body, timeout = API_TIMEOUT_MS, silent = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeout);
  const slowHint = (silent || timeout > API_TIMEOUT_MS) ? null : setTimeout(() => showToast("O servidor está acordando. Pode levar até 1 minuto na primeira vez.", { ms: 8000 }), 8000);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === "AbortError"
      ? "O servidor não respondeu a tempo. Tente de novo em instantes."
      : "Sem conexão com o servidor. Confira a internet e tente de novo.");
  } finally { clearTimeout(killer); clearTimeout(slowHint); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* sem corpo */ }
  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    // sessão expirou: volta para o login em vez de deixar o app "travado"
    clearToken(); state.user = null; hideScreenLoader(true); showLogin();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (!res.ok) throw new Error((data && data.error) || "Erro de conexão com o servidor");
  if (method !== "GET" && !silent && !path.startsWith("/auth/")) scheduleSyncBaseline(); // minha própria alteração não conta como "mudança de outro aparelho"
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
// Se a busca falhar (internet caiu, servidor lento), mantém o que já estava na tela em vez de zerar.
// Antes, um erro passageiro esvaziava as contas e parecia que "o banco sumiu" depois de sincronizar.
async function refreshAccounts() {
  try { state.accounts = await api("/pluggy/accounts"); }
  catch (e) { console.warn("contas: mantendo dados anteriores —", e.message); }
}
async function refreshInvestments() {
  try { const r = await api("/investments"); state.investments = r.investments || []; state.investHistory = r.history || []; }
  catch (e) { console.warn("investimentos: mantendo dados anteriores —", e.message); }
}
async function refreshPluggyItems() {
  try { state.pluggyItems = await api("/pluggy/items"); }
  catch (e) { console.warn("conexões: mantendo dados anteriores —", e.message); }
}
async function refreshCategories() {
  try {
    const r = await api("/categories");
    state.customCategories = r.custom || [];
    state.categoryOverrides = r.overrides || {};
  } catch (e) {
    console.warn("categorias: mantendo dados anteriores —", e.message);
  }
}
async function refreshAll() {
  await Promise.all([refreshMe(), refreshTransactions(), refreshPluggyItems(), refreshAccounts(), refreshCategories(), refreshInvestments()]);
  lastDataFetch = Date.now();
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
  return a.type === "CREDIT" && !/^cart[aã]o/i.test(n) ? `Cartão ${n}` : n;
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
// "chute" da IA (modelo treinado no seu histórico ou Claude): aparece com o selo "IA" para você confirmar ou corrigir
function isGuess(t) { return t.category_source === "model" || t.category_source === "llm"; }
function needsReview(t) { return !Number(t.category_manual) && (t.category === "nao_identificada" || isGuess(t)); }
function sourceLabel(t) {
  if (Number(t.category_manual) || t.category_source === "manual") return "Você";
  return { learned: "Aprendido com suas correções", rule: "Regra automática", pluggy: "Categoria do banco", model: "IA (seu histórico)", llm: "IA (Claude)" }[t.category_source] || (t.category === "nao_identificada" ? "—" : "Automática");
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
let sortMode = { tx: "recent", es: "recent", catdet: "recent" }; // ordenação por valor de cada tela
let esTipo = "entrada";
let catSegment = "gastos";
let catDetalhe = null;
let catMode = "cats";      // "cats" | "comparar" (Comparar meses agora vive dentro de Categorias)
let catMonth = null;       // "AAAA-MM" do mês mostrado em Categorias (null = mês atual)
let compTipo = "saida";
let delSimId = null;
let planMonth = null;   // "AAAA-MM" mostrado na aba Planejamento
let planMode = "futuros"; // "futuros" | "metas"
let editingPlanId = null;
const ES_PAGE = 60;
let esVisibleCount = ES_PAGE;
const metaOpen = new Set();   // categorias com a lista de subtítulos aberta (Metas)
let payPlanId = null;
let editingGoalCategory = null;
let editingGoalId = null; // meta existente sendo editada (null = nova)       // transação aguardando a resposta "excluir as parecidas?"
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
  const out = { vermelho: dark ? "#F43F5E" : "#BE123C", rosa: dark ? "#F87171" : "#E5484D" }[currentAccent()] || (dark ? "#FB7185" : "#E5484D");
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
  planejamento: { label: "Planejamento", svg: '<path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>' },
  investimentos:{ label: "Investimentos", svg: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  creditos:     { label: "Créditos",      svg: '<path d="M12 21s-7-4.6-9.3-9A5.2 5.2 0 0112 6a5.2 5.2 0 019.3 6c-2.3 4.4-9.3 9-9.3 9z"/>' },
  bancos:       { label: "Instituições",   svg: '<path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/>' }
};
const NAV_DEFAULT = { order: ["inicio","transacoes","categorias","planejamento","investimentos","bancos","creditos"], hidden: ["bancos","creditos"] };
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
function saveNavCfg(c) { localStorage.setItem("navCfg", JSON.stringify(c)); renderBottomNav(); pushUiPrefs(); }
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
      <span class="nav-handle" title="Arraste para mudar a ordem">${ICONS.grip(18)}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${NAV_DEFS[id].svg}</svg>
      <span class="nav-edit-name">${NAV_DEFS[id].label}</span>
      <button type="button" class="nav-eye" data-toggle="${id}" aria-label="${off ? "Mostrar" : "Esconder"} ${NAV_DEFS[id].label}">${off ? ICONS.eyeOff(18) : ICONS.eye(18)}</button>
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
    localStorage.setItem("accent", b.dataset.accent); applyAccent(); renderAccentPicker(); pushUiPrefs();
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
  if (["inicio", "categorias"].includes(currentScreen)) renderScreen(currentScreen);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function showLogin() {
  document.getElementById("screen-login").classList.add("active");
  document.getElementById("main-app").classList.remove("active");
}
function showApp() {
  syncSig = null; setTimeout(syncCheck, 1200);
  if (introAnim) setTimeout(() => { introAnim = false; }, 2600);
  document.getElementById("screen-login").classList.remove("active");
  document.getElementById("main-app").classList.add("active");
  const last = localStorage.getItem("lastScreen");
  navigateTo(last && NAV_DEFS[last] ? last : "inicio", { refresh: last && NAV_DEFS[last] && last !== "inicio" });
  setTimeout(checkReviewPrompt, 700);
  setTimeout(maybeAutoTutorial, 1800);
  setTimeout(() => autoSyncAll(), 2500);
}
const BRAND_HTML = '<span class="brand"><img class="brand-mark" src="icon-192.png" alt="" width="26" height="26"><span class="brand-name">Fluxo</span></span>';
function navigateTo(screen, { refresh = true, swipeDir = null } = {}) {
  const remember = screen === "categoria-detalhe" ? "categorias" : screen;
  if (NAV_DEFS[remember]) localStorage.setItem("lastScreen", remember); // ao reabrir o app volta para onde você parou
  if (screen === "transacoes" && currentScreen !== "transacoes") txVisibleCount = TX_PAGE_SIZE;
  if (screen === "categorias" && currentScreen !== "categorias" && currentScreen !== "categoria-detalhe") catMonth = null; // ao entrar, sempre o mês atual
  if (screen === "planejamento" && currentScreen !== "planejamento") planMonth = null;
  if (screen !== currentScreen) flashLoader();
  currentScreen = screen;
  document.querySelectorAll(".content .screen").forEach(s => s.classList.remove("active", "swipe-in-left", "swipe-in-right"));
  const target = document.querySelector(`.screen[data-screen="${screen}"]`);
  if (target) {
    void target.offsetWidth;
    target.classList.add("active");
    if (swipeDir) {
      target.classList.add(swipeDir === "left" ? "swipe-in-left" : "swipe-in-right");
      target.addEventListener("animationend", () => target.classList.remove("swipe-in-left", "swipe-in-right"), { once: true });
    }
  }
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === (screen === "categoria-detalhe" ? "categorias" : screen)));
  const titles = { inicio: "Início", bancos: "Minhas instituições", investimentos: "Investimentos", creditos: "Créditos", "categoria-detalhe": catDetalhe ? catInfo(catDetalhe).name : "Categoria", transacoes: "Transações", categorias: "Categorias", "entradas-saidas": esTipo === "entrada" ? "Entradas" : "Saídas" };
  const topTitle = document.getElementById("topbar-title");
  if (screen === "inicio") topTitle.innerHTML = BRAND_HTML; else topTitle.textContent = titles[screen] || "";
  const backBtn = document.getElementById("btn-back");
  if (backBtn) backBtn.classList.toggle("hidden", screen !== "entradas-saidas" && screen !== "categoria-detalhe");
  renderScreen(screen);
  document.getElementById("content").scrollTop = 0;
  loadScreenData(screen, refresh);
}
// Ao trocar de tela, desenha na hora com o que já está na memória. Só busca no servidor se os dados
// tiverem mais de 1 minuto (antes eram 4 chamadas a cada troca de aba, e o servidor grátis é lento).
let lastDataFetch = 0;
let dataFetching = false;
async function loadScreenData(screen, refresh) {
  if (!refresh || !state.user || dataFetching) return;
  if (Date.now() - lastDataFetch < DATA_TTL_MS) return;
  dataFetching = true;
  showScreenLoader();
  try {
    await Promise.all([refreshTransactions(), refreshAccounts(), refreshPluggyItems(), refreshInvestments()]);
    lastDataFetch = Date.now();
    if (state.user) renderScreen(currentScreen);
  } catch (e) {
    console.warn("não foi possível atualizar os dados:", e.message);
    lastDataFetch = Date.now() - DATA_TTL_MS + 10000; // tenta de novo em ~10 s, sem ficar repetindo o aviso
    showToast("Não deu para atualizar agora. Estou mostrando os últimos dados salvos. " + e.message, { error: true });
  } finally {
    dataFetching = false;
    hideScreenLoader();
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
  if (screen === "planejamento") renderPlanejamento();
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
  { id: "month", label: "Mês atual" },
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
const FILTERS_KEY = "fluxo_filtros_v1";
// Salva filtros/ordenação/abas no aparelho para voltarem iguais ao recarregar a página
function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({
      dashPeriodo: dashFilterPeriodo, dashBanco: dashFilterBanco,
      txPeriodo: txFilterPeriodo, txBanco: txFilterBanco, txTipo: txFilterTipo, txCategoria: txFilterCategoria, txSearch,
      sort: sortMode, esTipo, catSegment, catMode, planMode
    }));
  } catch (e) { /* armazenamento indisponível: segue sem salvar */ }
}
function loadSavedFilters() {
  let sv = null;
  try { sv = JSON.parse(localStorage.getItem(FILTERS_KEY) || "null"); } catch (e) { sv = null; }
  if (!sv || typeof sv !== "object") return;
  const str = (v) => (typeof v === "string" && v.length > 0 && v.length <= 120 ? v : null);
  const oneOf = (v, list) => (list.includes(v) ? v : null);
  const per = (v) => (v === "all" || v === "current" || /^\d{4}-\d{2}$/.test(v || "") ? v : null);
  dashFilterPeriodo = per(sv.dashPeriodo) || dashFilterPeriodo;
  dashFilterBanco = str(sv.dashBanco) || dashFilterBanco;
  txFilterPeriodo = TX_PERIODS.some(x => x.id === sv.txPeriodo) ? sv.txPeriodo : txFilterPeriodo;
  txFilterBanco = str(sv.txBanco) || txFilterBanco;
  txFilterTipo = oneOf(sv.txTipo, ["all", "entrada", "saida"]) || txFilterTipo;
  txFilterCategoria = str(sv.txCategoria) || txFilterCategoria;
  txSearch = typeof sv.txSearch === "string" ? sv.txSearch.slice(0, 80) : "";
  if (sv.sort && typeof sv.sort === "object") ["tx", "es", "catdet"].forEach(k => { if (SORT_CYCLE.includes(sv.sort[k])) sortMode[k] = sv.sort[k]; });
  esTipo = oneOf(sv.esTipo, ["entrada", "saida"]) || esTipo;
  catSegment = oneOf(sv.catSegment, ["gastos", "ganhos"]) || catSegment;
  catMode = oneOf(sv.catMode, ["cats", "comparar"]) || catMode;
  planMode = oneOf(sv.planMode, ["futuros", "metas"]) || planMode;
}
loadSavedFilters();
function filterTx(txs, { periodo, range, banco, tipo, categoria, search } = {}) {
  // "current" = mês atual, calculado na hora (vira o mês sozinho, sem precisar reabrir o app)
  const ym = periodo === "current" ? curYm() : periodo;
  return txs.filter(t => {
    if (range && (t.date < range.from || t.date > range.to)) return false;
    if (ym && ym !== "all" && t.date.slice(0,7) !== ym) return false;
    if (banco && banco !== "all" && t.bank_id !== banco) return false;
    if (tipo && tipo !== "all" && t.type !== tipo) return false;
    if (categoria && categoria !== "all" && effectiveCategory(t) !== categoria) return false;
    if (search && !String(t.desc || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function populateDashboardFilters() {
  const months = getAvailableMonths();
  const periodoSel = document.getElementById("filter-periodo");
  // período salvo que não existe mais (ex.: mês sem transações) volta para "Todo o período"
  if (months.length && dashFilterPeriodo !== "all" && dashFilterPeriodo !== "current" && !months.includes(dashFilterPeriodo)) dashFilterPeriodo = "all";
  setSelect(periodoSel, `<option value="all">Todo o período</option><option value="current">Mês atual</option>` +
    months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join(""), dashFilterPeriodo);

  const bancoSel = document.getElementById("filter-banco");
  const institutions = bankAccountsOnly();
  if (institutions.length && dashFilterBanco !== "all" && !institutions.some(i => i.id === dashFilterBanco)) dashFilterBanco = "all";
  setSelect(bancoSel, `<option value="all">Todos os bancos</option>` +
    institutions.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join(""), dashFilterBanco);
}
function monthLabel(ym) {
  const [y,m] = ym.split("-");
  return `${MONTH_NAMES[parseInt(m)-1]} ${y}`;
}
function monthOptionLabel(ym) { return ym === curYm() ? `${monthLabel(ym)} — Mês atual` : monthLabel(ym); }
function monthLabelWithTag(ym) { return monthOptionLabel(ym); }

function renderDashboard() {
  populateDashboardFilters();
  saveFilters();
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

  countTo(document.getElementById("balance-total"), saldo, { fmt: heroMoneyHtml, html: true });
  countTo(document.getElementById("total-entradas"), entradas);
  countTo(document.getElementById("total-saidas"), saidas);
  document.getElementById("balance-change").textContent = txs.length ? `${txs.length} transaç${txs.length === 1 ? "ão" : "ões"} no período` : "Nenhuma transação no período";
  const movimento = entradas + saidas;
  const pctIn = movimento ? Math.round((entradas / movimento) * 100) : 50;
  const flowIn = document.getElementById("flow-in"), flowOut = document.getElementById("flow-out");
  if (flowIn && flowOut) {
    flowIn.style.width = (movimento ? pctIn : 50) + "%";
    flowOut.style.width = (movimento ? 100 - pctIn : 50) + "%";
    flowIn.parentElement.classList.toggle("empty", !movimento);
  }
  drawHeroFlow(txs);

  const banksScroll = document.getElementById("banks-scroll");
  banksScroll.innerHTML = banks.map(i => {
    const val = typeof i.balance === "number" ? i.balance : state.transactions.filter(t => t.bank_id === i.id).reduce((s,t) => s + t.value, 0);
    return `<div class="bank-chip">
      ${bankLogo("bank-icon", i.logoName || i.name, i.color, i.name)}
      <div class="bank-chip-name" title="${esc(i.name)}">${esc(i.name)}</div>
      <div class="bank-amount">${fmtBRL(val)}</div>
    </div>`;
  }).join("") + `<button type="button" class="bank-chip add-bank-chip" data-nav="bancos">
      <div class="bank-icon add-icon">+</div>
      <div class="bank-chip-name">Adicionar</div>
      <div class="bank-amount bank-amount-sub">novo banco</div>
    </button>`;

  renderCards();
}

// "R$ 1.234,56" vira R$ pequeno + número grande + centavos pequenos (só tipografia, o valor é o mesmo)
function heroMoneyHtml(v) {
  const txt = fmtBRL(v);
  const m = txt.match(/^(-?)R\$ ([\d.]+)(,\d{2})$/);
  if (!m) return `<span class="cur">R$</span>${esc(txt.replace(/^-?R\$ ?/, ""))}`;
  return `<span class="cur">R$</span>${m[1] ? "-" : ""}${m[2]}<span class="cents">${m[3]}</span>`;
}
// Linha de "fluxo" do saldo dentro do período (soma acumulada das transações por dia). Só desenha; não altera dados.
function drawHeroFlow(txs) {
  const svg = document.getElementById("hero-flow");
  if (!svg) return;
  const W = 320, H = 70, PAD = 8;
  const byDay = {};
  txs.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.value; });
  const days = Object.keys(byDay).sort();
  let acc = 0;
  let pts = days.map(d => (acc += byDay[d]));
  if (valuesHidden() || pts.length < 2) pts = [0, 0.15, -0.1, 0.2, 0, 0.25, 0.1]; // linha calma de enfeite (sem dados ou valores escondidos)
  const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1;
  const xy = pts.map((v, i) => [ (i / (pts.length - 1)) * W, H - PAD - ((v - min) / span) * (H - PAD * 2) ]);
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1], [x1, y1] = xy[i], cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  svg.innerHTML = `<defs><linearGradient id="hf-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".28"/><stop offset="1" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${W},${H} L0,${H} Z" fill="url(#hf-fill)"/>
    <path d="${d}" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  if (!REDUCE_MOTION) { svg.classList.remove("draw"); void svg.getBoundingClientRect(); svg.classList.add("draw"); }
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
  esTipo = tipo; esVisibleCount = ES_PAGE;
  navigateTo("entradas-saidas", { refresh: false });
}
function esPeriodLabel() {
  if (dashFilterPeriodo === "all") return "Todo o período";
  return monthLabel(dashFilterPeriodo === "current" ? curYm() : dashFilterPeriodo);
}
// Lista separada por dia (um cartão por dia). Em "maior/menor valor" os dias continuam separados:
// cada dia aparece na posição da sua transação de maior/menor valor, e dentro do dia vale a ordenação escolhida.
// isIn: true/false mostra o total do dia (só entradas ou só saídas); null não mostra total.
function daysHtml(txs, { isIn = null, months = true, all = null } = {}) {
  const order = [], map = {}, totals = {};
  txs.forEach(t => { const d = t.date.slice(0, 10); if (!map[d]) { map[d] = []; order.push(d); } map[d].push(t); });
  (all || txs).forEach(t => { const d = t.date.slice(0, 10); totals[d] = (totals[d] || 0) + Math.abs(t.value); });
  let html = "", curMonth = null;
  order.forEach(d => {
    const mo = d.slice(0, 7);
    if (months && mo !== curMonth) { curMonth = mo; html += `<div class="tx-month-label">${monthLabel(mo)}</div>`; }
    const total = isIn === null ? "" : `<span class="es-day-total ${isIn ? "pos" : "neg"}">${isIn ? "+ " : "- "}${fmtBRL(totals[d])}</span>`;
    html += `<div class="tx-day-label es-day-head"><span>${esc(txDayLabel(d))}</span>${total}</div>` +
      `<div class="tx-group">${map[d].map(t => txRowHtml(t)).join("")}</div>`;
  });
  return html;
}
function renderEntradasSaidas() {
  saveFilters();
  const tipo = esTipo, isIn = tipo === "entrada";
  document.getElementById("topbar-title").textContent = isIn ? "Entradas" : "Saídas";
  renderSortSlot("es-sort-slot", "es");
  const base = filterTx(state.transactions, { periodo: dashFilterPeriodo, banco: dashFilterBanco })
    .filter(t => !isCreditTx(t) && t.type === tipo);
  const total = base.reduce((s, t) => s + Math.abs(t.value), 0);
  const sum = document.getElementById("es-summary");
  sum.className = "es-summary " + (isIn ? "in" : "out");
  sum.innerHTML = `<span class="es-sum-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${isIn ? '<path d="M7 17L17 7M8 7h9v9"/>' : '<path d="M17 7L7 17M16 17H7V8"/>'}</svg></span>` +
    `<div class="es-sum-body"><div class="es-sum-label">${isIn ? "Total de entradas" : "Total de saídas"}</div>` +
    `<div class="es-sum-value">${fmtBRL(total)}</div>` +
    `<div class="es-sum-sub">${base.length} ${base.length === 1 ? "movimentação" : "movimentações"} · ${esc(esPeriodLabel())}</div></div>`;
  const container = document.getElementById("es-list-container");
  if (!base.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma ${isIn ? "entrada" : "saída"} no período.</div>`;
    return;
  }
  const sorted = sortTxs(base, sortMode.es);
  const shown = sorted.slice(0, esVisibleCount);
  let html = daysHtml(shown, { isIn, months: sortMode.es === "recent", all: sorted });
  html += `<div class="tx-count-label">Mostrando ${shown.length} de ${sorted.length}</div>`;
  if (sorted.length > esVisibleCount) html += `<button type="button" class="btn btn-outline" id="btn-load-more-es">Carregar mais</button>`;
  container.innerHTML = html;
}

/* ============================================================
   CARTÕES DE CRÉDITO (seção própria, com tudo que o Pluggy traz)
   ============================================================ */
function kvRow(label, valueHtml) {
  if (valueHtml === null || valueHtml === undefined || valueHtml === "") return "";
  return `<div class="kv-row"><span>${esc(label)}</span><span>${valueHtml}</span></div>`;
}
const money = (v) => (num(v) !== null ? fmtBRL(v) : null);

const TRASH_SVG = ICONS.trash(16);
// Detalhes do cartão (fatura, vencimento etc.) ficam recolhidos; "Ver mais" abre, por cartão
const openCardDetails = new Set();
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
  const open = openCardDetails.has(a.account_id);
  const rows = [
    bill ? kvRow("Fatura", money(bill.totalAmount)) : "",
    bill ? kvRow("Vencimento", esc(fmtDate(bill.dueDate))) : kvRow("Vencimento", esc(fmtDate(c.balanceDueDate))),
    kvRow("Fechamento", esc(fmtDate(bill ? (bill.billClosingDate || c.balanceCloseDate) : c.balanceCloseDate))),
    kvRow("Pagamento mínimo", money(bill ? bill.minimumPaymentAmount : c.minimumPayment)),
    kvRow("Compras registradas", money(spent))
  ].join("");

  return `<div class="credit-card-item">
    <div class="credit-card-top" style="background:${color}">
      <div class="credit-card-name">${esc(title)}</div>
      <div class="credit-card-sub">${sub || "Cartão de crédito"}</div>
    </div>
    <div class="credit-card-body">
      ${pct !== null ? `<div class="limit-bar"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="limit-used">${pct.toFixed(0)}% do limite usado</div>` : ""}
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
      ${rows ? `<button type="button" class="cc-more" data-card-more="${esc(a.account_id)}">${open ? "Ver menos" : "Ver mais"} ${open ? "▲" : "▼"}</button><div class="kv-grid${open ? "" : " hidden"}">${rows}</div>` : ""}
      <div class="cc-actions">
        <button class="btn-connect card-tx-btn" type="button" data-card-tx="${esc(a.account_id)}">Ver transações</button>
        <button class="btn-connect danger" type="button" data-card-del="${esc(a.account_id)}">Excluir cartão</button>
      </div>
    </div>
  </div>`;
}

// Excluir cartão de vez (não volta na sincronização). Pergunta antes, com um aviso bem legível.
let cardToDelete = null;
function askDeleteCard(accountId) {
  const a = state.accounts.find(x => x.account_id === accountId);
  if (!a) return;
  cardToDelete = accountId;
  const d = a.data || {};
  const name = prettyName(d.marketingName || a.name) || "cartão";
  document.getElementById("del-card-name").textContent = `${name}${d.number ? " • final " + d.number : ""}`;
  openModal("modal-excluir-cartao");
}
async function confirmDeleteCard(btn) {
  const id = cardToDelete;
  if (!id) return;
  await withLoading(btn, async () => {
    try {
      await api(`/pluggy/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.accounts = state.accounts.filter(a => a.account_id !== id);
      state.transactions = state.transactions.filter(t => t.bank_id !== id);
      cardToDelete = null;
      closeAllModals();
      renderScreen(currentScreen);
      showToast("Cartão excluído. Ele não volta nas próximas sincronizações.");
      refreshTransactions().then(() => renderScreen(currentScreen)).catch(() => {});
    } catch (e) {
      showToast("Não foi possível excluir: " + e.message, { error: true });
    }
  }, { minMs: 300 });
}

function renderCards() {
  const wrap = document.getElementById("cards-wrap");
  const list = document.getElementById("cards-list");
  if (!wrap || !list) return;
  const cards = state.accounts.filter(a => a.type === "CREDIT");
  wrap.classList.toggle("hidden", !cards.length);
  list.innerHTML = cards.map(cardHtml).join("");
  const cnt = document.getElementById("cards-count");
  if (cnt) cnt.textContent = cards.length ? `${cards.length} ${cards.length === 1 ? "cartão" : "cartões"}` : "";
}

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
/* Donut das categorias: nítido em tela retina, fatias com respiro, animação de entrada e toque numa fatia
   mostra nome, valor e % no centro (toque de novo, ou no centro, para desmarcar). */
const donutStore = {};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
function fitFont(ctx, text, weight, maxPx, startPx, minPx = 9) {
  let px = startPx;
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  while (px > minPx && ctx.measureText(text).width > maxPx) { px -= 1; ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`; }
  return px;
}
function shortText(ctx, text, maxPx) {
  if (ctx.measureText(text).width <= maxPx) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxPx) t = t.slice(0, -1);
  return t + "…";
}
function paintDonut(canvasId, progress) {
  const st = donutStore[canvasId]; if (!st) return;
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { size, dpr, slices, total, label, selected } = st;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 9, thick = R * 0.34, rMid = R - thick / 2, rInner = R - thick;
  const textMain = themeColor("--text-main") || "#14213D";
  const textSecondary = themeColor("--text-secondary") || "#6B7A90";
  const emptyBg = themeColor("--gray-100") || "#EEF2F8";
  ctx.lineCap = "butt";
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";

  if (!slices.length) {
    ctx.beginPath(); ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
    ctx.lineWidth = thick; ctx.strokeStyle = emptyBg; ctx.stroke();
    ctx.fillStyle = textSecondary;
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText("Sem dados", cx, cy + 4);
    return;
  }

  const limit = -Math.PI / 2 + progress * Math.PI * 2;
  const gap = slices.length > 1 ? 0.045 : 0;
  slices.forEach((sl) => {
    const isSel = selected === sl.cat;
    const half = Math.min(gap / 2, (sl.a1 - sl.a0) * 0.3);
    const from = sl.a0 + half, to = Math.min(sl.a1 - half, limit);
    if (to <= from) return;
    const grow = isSel ? 5 : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, rMid + grow / 2, from, to);
    ctx.lineWidth = thick + grow;
    ctx.strokeStyle = sl.color;
    ctx.globalAlpha = selected && !isSel ? 0.35 : 1;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // texto do centro
  const inner = rInner * 2 - 22;
  const sel = selected ? slices.find(x => x.cat === selected) : null;
  if (sel) {
    const info = catInfo(sel.cat);
    const val = fmtBRL(sel.val);
    ctx.fillStyle = textSecondary;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText(shortText(ctx, info.name, inner), cx, cy - 12);
    ctx.fillStyle = textMain;
    fitFont(ctx, val, 800, inner, 20, 11);
    ctx.fillText(val, cx, cy + 9);
    ctx.fillStyle = sel.color;
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillText(`${((sel.val / total) * 100).toFixed(1).replace(".", ",")}% do total`, cx, cy + 27);
  } else {
    const val = fmtBRL(total);
    ctx.fillStyle = textSecondary;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText(label, cx, cy - 10);
    ctx.fillStyle = textMain;
    fitFont(ctx, val, 800, inner, 22, 11);
    ctx.fillText(val, cx, cy + 14);
  }
}
function drawDonut(canvasId, byCat, total, label = "gastos", { animate = true } = {}) {
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  const prev = donutStore[canvasId];
  if (prev && prev.raf) cancelAnimationFrame(prev.raf);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const box = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
  const size = Math.max(200, Math.min(268, box || 240));
  canvas.style.width = size + "px"; canvas.style.height = size + "px";
  canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);

  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  let start = -Math.PI / 2;
  const slices = total > 0 ? entries.map(([cat, val]) => {
    const ang = (val / total) * Math.PI * 2;
    const sl = { cat, val, a0: start, a1: start + ang, color: catInfo(cat).color };
    start += ang;
    return sl;
  }) : [];
  const st = donutStore[canvasId] = { size, dpr, slices, total, label, selected: null, raf: 0 };

  if (!canvas.dataset.wired) {
    canvas.dataset.wired = "1";
    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", (e) => {
      const cur = donutStore[canvasId]; if (!cur || !cur.slices.length) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
      const scale = cur.size / r.width; // canvas em px de layout
      const dist = Math.hypot(x, y) * scale;
      const R = cur.size / 2 - 9, rInner = R * 0.66;
      let hit = null;
      if (dist >= rInner - 4 && dist <= R + 10) {
        let a = Math.atan2(y, x); if (a < -Math.PI / 2) a += Math.PI * 2;
        const f = cur.slices.find(sl => a >= sl.a0 && a < sl.a1);
        hit = f ? f.cat : null;
      }
      cur.selected = hit && hit !== cur.selected ? hit : null;
      paintDonut(canvasId, 1);
      document.querySelectorAll("#cat-legend .legend-row").forEach(row => row.classList.toggle("active", !!cur.selected && row.dataset.cat === cur.selected));
    });
  }

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce || !slices.length) { paintDonut(canvasId, 1); return; }
  const t0 = performance.now(), DUR = 750;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / DUR);
    paintDonut(canvasId, easeOutCubic(t));
    if (t < 1) st.raf = requestAnimationFrame(tick); else st.raf = 0;
  };
  st.raf = requestAnimationFrame(tick);
}

function renderLegend(elId, byCat, total) {
  const el = document.getElementById(elId);
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { el.innerHTML = ""; return; }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? ((val / total) * 100).toFixed(1).replace(".", ",") : "0,0";
    return `<div class="legend-row" data-cat="${esc(cat)}" title="${esc(info.name)}">
      <span class="legend-dot" style="background:${info.color}"></span>
      <span class="legend-name">${info.icon} ${esc(info.name)}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join("");
}

/* ============================================================
   PLANEJAMENTO — gastos/ganhos futuros e metas por categoria
   ============================================================ */
let planItemsCache = [];
let goalsCache = [];
let subtitlesCache = [];
function parseValorInput(str) {
  const n = Number(String(str || "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : NaN;
}
async function loadPlanData() {
  [planItemsCache, goalsCache, subtitlesCache] = await Promise.all([api("/planned"), api("/goals"), api("/subtitles")]);
}
let planLoadedAt = 0;
function renderPlanejamento(force = false) {
  if (!planMonth) planMonth = curYm();
  saveFilters();
  document.querySelectorAll("#plan-mode .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.pmode === planMode));
  document.getElementById("plan-futuros").classList.toggle("hidden", planMode !== "futuros");
  document.getElementById("plan-metas").classList.toggle("hidden", planMode !== "metas");
  // Desenha na hora com o que já está em memória; só vai ao servidor se passou 1 minuto ou se algo foi alterado.
  const paint = () => { if (planMode === "futuros") renderPlanFuturos(); else renderMetas(); };
  const fresh = planLoadedAt && Date.now() - planLoadedAt < DATA_TTL_MS;
  if (fresh && !force) { paint(); return; }
  if (planLoadedAt && !force) paint();
  showScreenLoader();
  loadPlanData().then(() => { planLoadedAt = Date.now(); paint(); })
    .catch(e => showToast("Não foi possível carregar o planejamento: " + e.message, { error: true }))
    .finally(() => hideScreenLoader());
}
function planItemRowHtml(p) {
  const isIn = p.type === "entrada";
  const meta = [p.subtitle ? esc(p.subtitle) : "", p.day ? `dia ${p.day}` : ""].filter(Boolean).join(" · ");
  return `<div class="pl-item${p.paid ? " paid" : ""}" data-plan-id="${p.id}">
    <button type="button" class="pl-check" ${p.paid ? `data-plan-unpay="${p.id}" aria-label="Desfazer pagamento" title="Desfazer pagamento"` : `data-plan-pay="${p.id}" aria-label="Marcar como pago" title="Marcar como pago"`}>${p.paid ? ICONS.check(14) : ""}</button>
    <div class="pl-item-main"><div class="pl-item-name">${esc(p.name)}</div>${meta ? `<div class="pl-item-meta">${meta}</div>` : ""}</div>
    <div class="pl-item-value ${isIn ? "pos" : ""}">${isIn ? "+ " : ""}${fmtBRL(p.value)}</div>
    <div class="pl-item-actions">
      ${p.paid ? "" : `<button type="button" class="pl-ghost" data-plan-edit="${p.id}" aria-label="Editar">${ICONS.pencil(14)}</button>`}
      <button type="button" class="pl-ghost" data-plan-del="${p.id}" aria-label="Excluir">${ICONS.trash(14)}</button>
    </div>
  </div>`;
}
function renderPlanFuturos() {
  document.getElementById("plan-month-label").innerHTML = monthLabelWithTag(planMonth);
  // O planejamento é um mundo à parte: ignora o saldo real da conta. Cada mês começa zerado.
  const items = planItemsCache.filter(p => p.month === planMonth).sort((a, b) => (a.paid - b.paid) || ((a.day || 99) - (b.day || 99)) || (a.id - b.id));
  const ganho = items.filter(p => p.type === "entrada").reduce((s, p) => s + p.value, 0);
  const gasto = items.filter(p => p.type === "saida").reduce((s, p) => s + p.value, 0);
  const resultado = ganho - gasto;
  countTo(document.getElementById("plan-sum-planejado"), ganho);
  countTo(document.getElementById("plan-sum-gasto"), gasto);
  countTo(document.getElementById("plan-sum-resta"), Math.abs(resultado));
  const hero = document.getElementById("plan-sum-resta-card");
  hero.classList.toggle("neg", resultado < 0);
  hero.classList.toggle("pos", resultado >= 0);
  document.getElementById("plan-sum-resta-label").textContent = resultado >= 0 ? "Sobra prevista do mês" : "Faltam no mês";
  const barPct = ganho > 0 ? Math.min(100, (gasto / ganho) * 100) : (gasto > 0 ? 100 : 0);
  const bar = document.getElementById("plan-bar-gasto");
  bar.style.width = barPct.toFixed(1) + "%";
  bar.parentElement.classList.toggle("over", gasto > ganho);
  const el = document.getElementById("plan-list");
  if (!items.length) { el.innerHTML = `<div class="empty-state">Nada planejado para ${esc(monthLabel(planMonth))} ainda.<br>Toque em <b>Novo</b> para começar.</div>`; return; }

  const groups = {};
  items.forEach(p => { const k = p.category || "__sem"; (groups[k] = groups[k] || []).push(p); });
  const keys = Object.keys(groups).sort((a, b) => (a === "__sem") - (b === "__sem") || (a === "__sem" ? 0 : catInfo(a).name.localeCompare(catInfo(b).name)));
  el.innerHTML = keys.map((k, gi) => {
    const list = groups[k];
    const info = k === "__sem" ? { name: "Sem categoria", icon: "🗂️", color: "#64748B" } : catInfo(k);
    const total = list.reduce((s, p) => s + (p.type === "entrada" ? p.value : -p.value), 0);
    const done = list.filter(p => p.paid).length;
    return `<div class="pl-cat" style="--c:${esc(info.color || "#64748B")};animation-delay:${(gi * 0.05).toFixed(3)}s">
      <div class="pl-cat-head"><span class="pl-cat-ico">${info.icon}</span><span class="pl-cat-name">${esc(info.name)}</span>
        <span class="pl-cat-done">${done}/${list.length}</span><b class="pl-cat-total">${total < 0 ? "- " : ""}${fmtBRL(Math.abs(total))}</b></div>
      ${list.map(planItemRowHtml).join("")}
    </div>`;
  }).join("");
}
// Animação ao trocar de mês: só o conteúdo desliza (as setinhas ficam paradas) e os valores sobem de novo.
function animateMonthChange(wrapId, delta) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const dx = delta > 0 ? 14 : -14;
  let i = 0;
  wrap.querySelectorAll(":scope > *").forEach(el => {
    let target = el;
    if (el.classList.contains("month-nav")) {
      target = el.querySelector(".month-label");
      el.querySelectorAll(".month-arrow").forEach(a => { a.classList.remove("pm-tap"); void a.offsetWidth; a.classList.add("pm-tap"); });
    } else if (el.classList.contains("screen-hint") || el.classList.contains("hidden")) return;
    if (!target) return;
    target.style.setProperty("--dx", dx + "px");
    target.style.setProperty("--d", Math.min(i * 40, 240) + "ms");
    target.classList.remove("pm-anim"); void target.offsetWidth; target.classList.add("pm-anim");
    i++;
  });
}
function changePlanMonth(delta) {
  planMonth = shiftYm(planMonth || curYm(), delta);
  renderPlanFuturos();
  animateMonthChange("plan-futuros", delta);
  flashLoader(450);
}

/* ---------- dropdown customizado (categoria / subtítulo) ---------- */
function closeAllCSelects() {
  document.querySelectorAll(".cselect-panel.open").forEach(p => p.classList.remove("open"));
  document.querySelectorAll(".cselect.open").forEach(w => w.classList.remove("open"));
}
function toggleCSelect(wrapId) {
  const wrap = document.getElementById(wrapId);
  const panel = wrap.querySelector(".cselect-panel");
  const willOpen = !panel.classList.contains("open");
  closeAllCSelects();
  if (willOpen) { panel.classList.remove("hidden"); panel.classList.add("open"); wrap.classList.add("open"); }
}
document.addEventListener("click", (e) => { if (!e.target.closest(".cselect")) closeAllCSelects(); });

function renderCategoriaCSelect(selectedId) {
  const panel = document.getElementById("plan-categoria-panel");
  const opts = [{ id: "", name: "Sem categoria", icon: "🚫", color: "var(--gray-200)" }, ...allCategories()];
  panel.innerHTML = `<div class="cselect-scroll">${opts.map(c => `
    <button type="button" class="cselect-option ${c.id === selectedId ? "active" : ""}" data-value="${esc(c.id)}">
      <span class="cselect-opt-icon" style="background:${c.color}">${c.icon || ""}</span>
      <span class="cselect-opt-name">${esc(c.name)}</span>
      ${c.id === selectedId ? ICONS.check(14) : ""}
    </button>`).join("")}</div>`;
  const cur = opts.find(c => c.id === selectedId) || opts[0];
  document.querySelector("#plan-categoria-trigger .cselect-current").textContent = cur.name;
}
function renderSubtituloCSelect(selected, opts) {
  const panel = document.getElementById("plan-subtitulo-panel");
  const list = [{ name: "" }, ...opts];
  panel.innerHTML = `
    <div class="cselect-scroll">${list.map(s => `
      <button type="button" class="cselect-option ${s.name === selected ? "active" : ""}" data-value="${esc(s.name)}">
        <span class="cselect-opt-name">${s.name ? esc(s.name) : "Sem subtítulo"}</span>
        ${s.name === selected ? ICONS.check(14) : ""}
      </button>`).join("")}</div>
    <div class="cselect-divider"></div>
    <div class="cselect-add-row">
      <input type="text" id="plan-subtitulo-novo" placeholder="Novo subtítulo…" maxlength="40">
      <button type="button" class="cselect-add-btn" id="btn-add-subtitulo" aria-label="Criar subtítulo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>`;
  document.querySelector("#plan-subtitulo-trigger .cselect-current").textContent = selected || "Sem subtítulo";
}

/* ---------- modal de novo/editar gasto futuro (categoria + subtítulo + data por rolinho) ---------- */
const WHEEL_ITEM_H = 36;
function attachWheel(containerId, items, initialValue, onChange) {
  const el = document.getElementById(containerId);
  el.innerHTML = `<div class="wheel-spacer"></div>` + items.map(it => `<div class="wheel-item" data-val="${esc(String(it.value))}">${esc(it.label)}</div>`).join("") + `<div class="wheel-spacer"></div>`;
  const nodes = () => Array.from(el.querySelectorAll(".wheel-item"));
  const setActive = (idx) => nodes().forEach((n, i) => n.classList.toggle("active", i === idx));
  const clampIdx = (idx) => Math.min(items.length - 1, Math.max(0, idx));
  let initIdx = clampIdx(items.findIndex(it => String(it.value) === String(initialValue)));
  if (initIdx < 0) initIdx = 0;
  requestAnimationFrame(() => { el.scrollTop = initIdx * WHEEL_ITEM_H; setActive(initIdx); });
  let t = null;
  el.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const idx = clampIdx(Math.round(el.scrollTop / WHEEL_ITEM_H));
      el.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: "smooth" });
      setActive(idx);
      onChange(items[idx].value);
    }, 110);
  });
  el.addEventListener("click", (e) => {
    const item = e.target.closest(".wheel-item"); if (!item) return;
    const idx = nodes().indexOf(item);
    el.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: "smooth" });
  });
}
let planWheelDay = null, planWheelMonthNum = null, planWheelYearNum = null;
let planVariosMeses = false, planQtdMeses = 2;
function setupPlanWheels(baseYear, baseMonthNum, baseDay) {
  planWheelDay = baseDay || null;
  planWheelMonthNum = baseMonthNum;
  planWheelYearNum = baseYear;
  const diaItems = [{ value: "", label: "Sem dia" }, ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))];
  attachWheel("wheel-dia", diaItems, baseDay || "", v => { planWheelDay = v || null; });
  const mesItems = MES_ABREV.map((m, i) => ({ value: i + 1, label: m }));
  attachWheel("wheel-mes", mesItems, baseMonthNum, v => { planWheelMonthNum = v; });
  const anoItems = Array.from({ length: 14 }, (_, i) => baseYear - 4 + i).map(y => ({ value: y, label: String(y) }));
  attachWheel("wheel-ano", anoItems, baseYear, v => { planWheelYearNum = v; });
}
function refreshSubtitleOptions() {
  const catId = document.getElementById("plan-categoria").value;
  const wrap = document.getElementById("plan-subtitulo-wrap");
  const label = document.getElementById("plan-subtitulo-label");
  if (!catId) { wrap.classList.add("hidden"); label.classList.add("hidden"); closeAllCSelects(); return; }
  wrap.classList.remove("hidden"); label.classList.remove("hidden");
  const sel = document.getElementById("plan-subtitulo");
  const current = sel.value;
  const opts = subtitlesCache.filter(s => s.category === catId);
  sel.innerHTML = `<option value="">Sem subtítulo</option>` + opts.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
  const keep = opts.some(s => s.name === current) ? current : "";
  sel.value = keep;
  renderSubtituloCSelect(keep, opts);
}
function openPlanModal(id) {
  editingPlanId = id || null;
  const item = id ? planItemsCache.find(p => p.id === Number(id)) : null;
  document.getElementById("plan-modal-title").textContent = item ? "Editar item" : "Novo item";
  document.getElementById("plan-nome").value = item ? item.name : "";
  document.getElementById("plan-valor").value = item ? String(item.value).replace(".", ",") : "";
  const tipo = item ? item.type : "saida";
  document.querySelectorAll("#plan-tipo-seg .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.tipo === tipo));

  const catSel = document.getElementById("plan-categoria");
  catSel.innerHTML = `<option value="">Sem categoria</option>` + allCategories().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  catSel.value = item && item.category ? item.category : "";
  renderCategoriaCSelect(catSel.value);
  refreshSubtitleOptions();
  if (item && item.subtitle) {
    document.getElementById("plan-subtitulo").value = item.subtitle;
    refreshSubtitleOptions();
  }

  const baseMonth = item ? item.month : (planMonth || curYm());
  const [baseYear, baseMonthNum] = baseMonth.split("-").map(Number);
  setupPlanWheels(baseYear, baseMonthNum, item && item.day ? Number(item.day) : "");

  planVariosMeses = false;
  planQtdMeses = 2;
  document.getElementById("plan-varios-meses-check").checked = false;
  document.getElementById("plan-qtd-row").classList.add("hidden");
  document.getElementById("plan-qtd-value").textContent = "2";
  document.getElementById("plan-varios-wrap").classList.toggle("hidden", !!item);

  document.getElementById("plan-error").classList.add("hidden");
  openModal("modal-planejado");
}
async function addSubtituloInline() {
  const catId = document.getElementById("plan-categoria").value;
  const input = document.getElementById("plan-subtitulo-novo");
  const name = input ? input.value.trim() : "";
  if (!catId) { showToast("Escolha uma categoria antes de criar o subtítulo.", { error: true }); return; }
  if (!name) return;
  try {
    const created = await api("/subtitles", { method: "POST", body: { category: catId, name } });
    if (!subtitlesCache.some(s => s.id === created.id)) subtitlesCache.push(created);
    document.getElementById("plan-subtitulo").value = created.name;
    refreshSubtitleOptions();
    closeAllCSelects();
  } catch (e) { showToast("Não foi possível criar o subtítulo: " + e.message, { error: true }); }
}
async function savePlanejado() {
  const name = document.getElementById("plan-nome").value.trim();
  const value = parseValorInput(document.getElementById("plan-valor").value);
  const type = document.querySelector("#plan-tipo-seg .seg-btn.active")?.dataset.tipo || "saida";
  const category = document.getElementById("plan-categoria").value || null;
  const subtitle = category ? (document.getElementById("plan-subtitulo").value || null) : null;
  const errEl = document.getElementById("plan-error");
  errEl.classList.add("hidden");
  if (!name || !value || value <= 0 || !planWheelYearNum || !planWheelMonthNum) {
    errEl.textContent = "Preencha a descrição, o valor e escolha o mês.";
    errEl.classList.remove("hidden");
    return;
  }
  const baseMonth = `${planWheelYearNum}-${String(planWheelMonthNum).padStart(2, "0")}`;
  const qtd = (!editingPlanId && planVariosMeses) ? Math.max(1, planQtdMeses) : 1;
  const meses = Array.from({ length: qtd }, (_, i) => shiftYm(baseMonth, i));
  const day = planWheelDay || null;
  try {
    if (editingPlanId) {
      await api(`/planned/${editingPlanId}`, { method: "PUT", body: { name, value, type, month: baseMonth, category, subtitle, day } });
    } else {
      for (const month of meses) await api("/planned", { method: "POST", body: { name, value, type, month, category, subtitle, day } });
    }
    editingPlanId = null;
    closeAllModals();
    planMonth = meses[meses.length - 1];
    renderPlanejamento(true);
    showToast(meses.length > 1 ? `${meses.length} itens criados (um por mês).` : "Item salvo.");
  } catch (e) {
    errEl.textContent = e.message || "Não foi possível salvar.";
    errEl.classList.remove("hidden");
  }
}
async function deletePlanItem(id) {
  if (!confirm("Excluir este item do planejamento?")) return;
  try { await api(`/planned/${id}`, { method: "DELETE" }); renderPlanejamento(true); }
  catch (e) { showToast("Não foi possível excluir: " + e.message, { error: true }); }
}
function askMarkPaid(id) {
  payPlanId = id;
  const item = planItemsCache.find(p => p.id === Number(id));
  document.getElementById("pay-item-name").textContent = item ? `${item.name} — ${fmtBRL(item.value)}` : "";
  openModal("modal-marcar-pago");
}
async function confirmMarkPaid(btn) {
  const id = payPlanId; if (!id) return;
  await withLoading(btn, async () => {
    try {
      const updated = await api(`/planned/${id}/pay`, { method: "POST" });
      // Atualiza o cache local na hora (não depende só do refetch) para o item
      // mudar de status na lista imediatamente, sem esperar outra ida ao servidor.
      const idx = planItemsCache.findIndex(p => p.id === Number(id));
      if (idx !== -1) planItemsCache[idx] = { ...planItemsCache[idx], ...updated, paid: true };
      payPlanId = null;
      closeAllModals();
      repaintPlan();
      showToast("Marcado como pago (só no planejamento, não mexe no saldo real).");
    } catch (e) { showToast("Não foi possível marcar como pago: " + e.message, { error: true }); }
  });
}
// redesenha a aba Planejamento no modo em que ela está (lista de gastos futuros ou metas)
function repaintPlan() { if (planMode === "metas") renderMetas(); else renderPlanFuturos(); }
async function unpayPlanItem(id) {
  if (!confirm("Desfazer? O item volta a aparecer como não pago.")) return;
  try {
    await api(`/planned/${id}/unpay`, { method: "POST" });
    const idx = planItemsCache.findIndex(p => p.id === Number(id));
    if (idx !== -1) planItemsCache[idx] = { ...planItemsCache[idx], paid: false, tx_id: null };
    repaintPlan();
  }
  catch (e) { showToast("Não foi possível desfazer: " + e.message, { error: true }); }
}

/* ---------- metas por categoria ---------- */
function goalFor(category, month) {
  return goalsCache.find(g => g.category === category && g.month === month)
    || goalsCache.find(g => g.category === category && g.month === null)
    || null;
}
function metaSubtitlesHtml(catId, catItems) {
  const subs = subtitlesCache.filter(sb => sb.category === catId);
  const sum = (arr) => arr.reduce((t, p) => t + p.value, 0);
  const known = new Set(subs.map(sb => sb.name));
  const groups = subs.map(sb => ({ name: sb.name, items: catItems.filter(p => p.subtitle === sb.name) }));
  const loose = catItems.filter(p => !p.subtitle || !known.has(p.subtitle));
  if (loose.length) groups.push({ name: "Sem subtítulo", items: loose });
  const rows = groups.filter(g => g.items.length).map(g => {
    const planned = sum(g.items), paid = sum(g.items.filter(p => p.paid));
    const all = g.items.every(p => p.paid), partial = paid > 0 && !all;
    const items = g.items.map(p => `<div class="meta-item${p.paid ? " paid" : ""}"><span class="meta-item-check">${p.paid ? ICONS.check(10) : ""}</span><span class="meta-item-name">${esc(p.name)}</span><span class="meta-item-val">${fmtBRL(p.value)}</span></div>`).join("");
    return `<div class="meta-sub-group${all ? " done" : ""}">
      <div class="meta-sub-row">
        <span class="meta-sub-check${all ? " on" : partial ? " half" : ""}">${all ? ICONS.check(11) : ""}</span>
        <span class="meta-sub-row-name">${esc(g.name)}</span>
        <span class="meta-sub-row-val">${partial ? `<small>${fmtBRL(paid)} de</small> ` : ""}${fmtBRL(planned)}</span>
      </div>${items}</div>`;
  });
  if (!rows.length) return "";
  const open = metaOpen.has(catId);
  return `
    <button type="button" class="meta-sub-toggle${open ? " open" : ""}" data-sub-toggle="${esc(catId)}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      Ver por subtítulo
    </button>
    <div class="meta-sub-list${open ? " open" : ""}" id="meta-sub-list-${esc(catId)}">${rows.join("")}</div>`;
}
function renderMetas() {
  const ym = curYm(); // só o mês atual
  const cats = allCategories().filter(c => c.id !== "salario" && c.id !== "nao_identificada");
  const el = document.getElementById("metas-list");
  el.innerHTML = cats.map((c, i) => {
    const styleAttr = `style="--cat-color:${c.color}; animation-delay:${(i * 0.06).toFixed(3)}s"`;
    const goal = goalFor(c.id, ym);
    const catItems = planItemsCache.filter(p => p.category === c.id && p.month === ym && p.type === "saida");
    const gasto = catItems.reduce((t, p) => t + p.value, 0);
    const pago = catItems.filter(p => p.paid).reduce((t, p) => t + p.value, 0);
    const subs = metaSubtitlesHtml(c.id, catItems);
    const legend = gasto > 0 ? `<div class="meta-legend"><span><i class="dot paid"></i>Pago ${fmtBRL(pago)}</span><span><i class="dot plan"></i>Planejado ${fmtBRL(gasto)}</span></div>` : "";
    if (!goal) {
      return `<div class="meta-row" ${styleAttr} data-cat="${esc(c.id)}">
        <div class="cat-icon" style="background:${c.color}">${c.icon}</div>
        <div class="meta-row-main">
          <div class="cat-name">${esc(c.name)}</div>
          <div class="cat-pct">${gasto > 0 ? `${fmtBRL(pago)} pago de ${fmtBRL(gasto)} planejado` : `Nada planejado em ${esc(monthLabel(ym))}`}</div>
          ${subs}
        </div>
        <button type="button" class="btn-link-small" data-meta-def="${esc(c.id)}">Definir meta</button>
      </div>`;
    }
    const diff = goal.value - gasto;
    const pctPlan = goal.value > 0 ? Math.min(100, (gasto / goal.value) * 100) : 0;
    const pctPaid = goal.value > 0 ? Math.min(100, (pago / goal.value) * 100) : 0;
    const over = gasto > goal.value;
    return `<div class="meta-row meta-row-set" ${styleAttr} data-cat="${esc(c.id)}" data-meta-edit="${esc(c.id)}">
      <div class="meta-row-top">
        <div class="meta-row-head">
          <div class="cat-icon" style="background:${c.color}">${c.icon}</div>
          <div class="meta-row-main"><div class="cat-name">${esc(c.name)}</div><div class="cat-pct">Meta: ${fmtBRL(goal.value)}${goal.month ? " (só " + esc(monthLabel(goal.month)) + ")" : ""}</div></div>
        </div>
        <div class="meta-amount">${fmtBRL(gasto)}</div>
      </div>
      <div class="cat-bar meta-bar" role="img" aria-label="Pago ${fmtBRL(pago)} de ${fmtBRL(gasto)} planejado"><i class="meta-bar-plan${over ? " over" : ""}" style="width:${pctPlan.toFixed(1)}%"></i><i class="meta-bar-paid" style="width:${pctPaid.toFixed(1)}%"></i></div>
      ${legend}
      <div class="meta-status ${over ? "over" : ""}">${over ? "Passou " + fmtBRL(Math.abs(diff)) : "Resta " + fmtBRL(diff)} da meta</div>
      ${subs}
    </div>`;
  }).join("");
}
const MES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
// Todos os goals de meses específicos (não fixos) de uma categoria, dentro do ano informado.
function specificGoalsFor(category, year) {
  return goalsCache.filter(g => g.category === category && g.month && g.month.startsWith(year));
}
function renderMesesGrid(category, year) {
  const set = new Set(specificGoalsFor(category, year).map(g => g.month));
  const grid = document.getElementById("meta-meses-grid");
  const curM = curYm();
  grid.innerHTML = MES_ABREV.map((label, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
    return `<button type="button" class="month-check ${set.has(ym) ? "active" : ""} ${ym === curM ? "is-current" : ""}" data-mes="${ym}">${label}</button>`;
  }).join("");
}
function openMetaModal(catId) {
  editingGoalCategory = catId;
  const ym = planMonth || curYm();
  const year = ym.slice(0, 4);
  const goal = goalFor(catId, ym);
  const specificos = specificGoalsFor(catId, year);
  editingGoalId = goal ? goal.id : null;
  const info = catInfo(catId);
  document.getElementById("meta-modal-title").textContent = `Meta — ${info.name}`;
  document.getElementById("meta-valor").value = goal ? String(goal.value).replace(".", ",") : "";
  const tipo = specificos.length ? "especifico" : "fixo";
  document.querySelectorAll("#meta-tipo-seg .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.metatipo === tipo));
  renderMesesGrid(catId, year);
  document.getElementById("meta-meses-grid").classList.toggle("hidden", tipo !== "especifico");
  document.getElementById("meta-error").classList.add("hidden");
  document.getElementById("btn-remover-meta").classList.toggle("hidden", !goal && !specificos.length);
  openModal("modal-meta");
}
async function saveMeta() {
  const value = parseValorInput(document.getElementById("meta-valor").value);
  const tipo = document.querySelector("#meta-tipo-seg .seg-btn.active")?.dataset.metatipo || "fixo";
  const errEl = document.getElementById("meta-error");
  errEl.classList.add("hidden");
  if (!value || value <= 0) { errEl.textContent = "Informe um valor válido."; errEl.classList.remove("hidden"); return; }
  const ym = planMonth || curYm();
  const year = ym.slice(0, 4);
  try {
    if (tipo === "fixo") {
      await api("/goals", { method: "POST", body: { category: editingGoalCategory, value, month: null } });
      // remove metas de meses específicos que existiam, já que agora é fixa para todo mês
      for (const g of specificGoalsFor(editingGoalCategory, year)) await api(`/goals/${g.id}`, { method: "DELETE" });
    } else {
      const selected = Array.from(document.querySelectorAll("#meta-meses-grid .month-check.active")).map(b => b.dataset.mes);
      if (!selected.length) { errEl.textContent = "Escolha ao menos um mês."; errEl.classList.remove("hidden"); return; }
      const existentes = specificGoalsFor(editingGoalCategory, year);
      const paraRemover = existentes.filter(g => !selected.includes(g.month));
      for (const g of paraRemover) await api(`/goals/${g.id}`, { method: "DELETE" });
      for (const month of selected) await api("/goals", { method: "POST", body: { category: editingGoalCategory, value, month } });
    }
    closeAllModals();
    renderPlanejamento(true);
    showToast("Meta salva.");
  } catch (e) { errEl.textContent = e.message || "Não foi possível salvar a meta."; errEl.classList.remove("hidden"); }
}
async function removeMeta() {
  const ym = planMonth || curYm();
  const year = ym.slice(0, 4);
  const ids = new Set();
  if (editingGoalId) ids.add(editingGoalId);
  specificGoalsFor(editingGoalCategory, year).forEach(g => ids.add(g.id));
  if (!ids.size) { closeAllModals(); return; }
  try {
    for (const id of ids) await api(`/goals/${id}`, { method: "DELETE" });
    closeAllModals();
    renderPlanejamento(true);
  } catch (e) { showToast("Não foi possível remover: " + e.message, { error: true }); }
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
  const ym = catMonth || curYm();
  const txs = sortTxs(state.transactions
    .filter(t => t.date.slice(0, 7) === ym && (isGasto ? t.type === "saida" : t.type === "entrada") && effectiveCategory(t) === catDetalhe), sortMode.catdet);
  const total = txs.reduce((s, t) => s + Math.abs(t.value), 0);
  const el = document.getElementById("catdet-container");
  const head = `<div class="card catdet-head">
    <div class="cat-icon" style="background:${info.color}">${info.icon}</div>
    <div><div class="cat-name">${esc(info.name)}</div>
    <div class="cat-pct">${txs.length} ${isGasto ? "gasto" : "ganho"}${txs.length === 1 ? "" : "s"} • ${esc(monthLabel(ym))}</div></div>
    <div class="cat-amount catdet-total ${isGasto ? "neg" : "pos"}">${fmtBRL(total)}</div>
  </div>`;
  el.innerHTML = head + (txs.length ? sortBtnHtml("catdet") + daysHtml(txs, { isIn: !isGasto, months: false }) : `<div class="empty-state">Nenhuma transação nesta categoria neste mês.</div>`);
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
const INV_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#F97316", "#84CC16"];
function renderInvestimentos() {
  const invs = (state.investments || []).filter(v => v.balance > 0 || v.balance < 0);
  const list = document.getElementById("inv-list");
  const split = document.getElementById("inv-split");
  const stats = document.getElementById("inv-stats");
  const total = invs.reduce((s, v) => s + (v.balance || 0), 0);
  document.getElementById("inv-total").textContent = fmtBRL(total);
  if (!invs.length) {
    document.getElementById("inv-change").textContent = "Nenhum investimento encontrado";
    split.innerHTML = ""; stats.innerHTML = "";
    list.innerHTML = `<div class="empty-state">Nenhum banco conectado tem investimentos. Se você investe e não aparece, toque em Sincronizar em "Minhas instituições".</div>`;
    return;
  }
  const yieldOf = (v) => (v.amount_original != null ? v.balance - v.amount_original : (v.profit != null ? v.profit : null));
  const known = invs.filter(v => yieldOf(v) !== null);
  const totalYield = known.reduce((s, v) => s + yieldOf(v), 0);
  const knownNow = known.reduce((s, v) => s + v.balance, 0);
  const knownApplied = knownNow - totalYield;
  const pctTxt = (y, base) => (base > 0 ? ` (${y >= 0 ? "+" : "-"}${Math.abs((y / base) * 100).toFixed(2).replace(".", ",")}%)` : "");
  const fmtYield = (y) => `<span class="inv-delta ${y >= 0 ? "pos" : "neg"}">${y >= 0 ? "+" : "-"}${fmtBRL(Math.abs(y))}</span>`;
  document.getElementById("inv-change").innerHTML = known.length ? `Rendeu ${fmtYield(totalYield)}${pctTxt(totalYield, knownApplied)} até hoje` : "";

  const byItem = {};
  invs.forEach(v => (byItem[v.item_id] = byItem[v.item_id] || []).push(v));
  const banks = Object.entries(byItem).map(([itemId, arr]) => ({ itemId, arr, sub: arr.reduce((s, v) => s + v.balance, 0) })).sort((a, b) => b.sub - a.sub);
  const pos = banks.reduce((s, g) => s + Math.max(0, g.sub), 0);
  banks.forEach((g, i) => { g.color = INV_COLORS[i % INV_COLORS.length]; g.pct = pos > 0 ? (Math.max(0, g.sub) / pos) * 100 : 0; });

  stats.innerHTML = known.length ? `
    <div class="inv-stat"><span>Aplicado</span><strong>${fmtBRL(knownApplied)}</strong></div>
    <div class="inv-stat"><span>Valor atual</span><strong>${fmtBRL(knownNow)}</strong></div>
    <div class="inv-stat ${totalYield >= 0 ? "up" : "down"}"><span>Rendeu</span><strong>${totalYield >= 0 ? "+" : "-"}${fmtBRL(Math.abs(totalYield))}</strong></div>` : "";

  split.innerHTML = pos > 0 ? `<div class="card inv-split-card">
      <div class="inv-split-title">Onde está seu dinheiro</div>
      <div class="inv-split-bar">${banks.filter(g => g.pct > 0).map(g => `<i style="width:${g.pct.toFixed(2)}%;background:${g.color}"></i>`).join("")}</div>
      <div class="inv-split-legend">${banks.filter(g => g.pct > 0).map(g => `<span><i class="dot" style="background:${g.color}"></i>${esc(itemTitle(g.itemId))} <b>${g.pct.toFixed(0)}%</b></span>`).join("")}</div>
    </div>` : "";

  list.innerHTML = banks.map(g => {
    const gKnown = g.arr.filter(v => yieldOf(v) !== null);
    const gYield = gKnown.reduce((s, v) => s + yieldOf(v), 0);
    const gApplied = gKnown.reduce((s, v) => s + v.balance, 0) - gYield;
    const rows = g.arr.slice().sort((a, b) => b.balance - a.balance).map(v => {
      const y = yieldOf(v);
      const applied = y !== null ? v.balance - y : null;
      const share = g.sub > 0 ? Math.max(0, Math.min(100, (v.balance / g.sub) * 100)) : 0;
      return `<div class="inv-row">
        <div class="inv-row-top"><div class="inv-name">${esc(v.name)}</div><div class="inv-bal">${fmtBRL(v.balance)}</div></div>
        <div class="inv-row-bar"><i style="width:${share.toFixed(1)}%;background:${g.color}"></i></div>
        ${y !== null ? `<div class="inv-row-meta"><span>Aplicado ${fmtBRL(applied)}</span><span>Rendeu ${fmtYield(y)}${pctTxt(y, applied)}</span></div>` : ""}
      </div>`;
    }).join("");
    return `<div class="card inv-bank" style="--inv-c:${g.color}">
      <div class="inv-bank-head">
        <div class="inv-bank-title">${bankLogo("bank-avatar sm", itemTitle(g.itemId), "#059669")}<div><h3>${esc(itemTitle(g.itemId))}</h3><div class="inv-bank-share">${g.pct.toFixed(0)}% do total${gKnown.length ? ` · rendeu ${fmtYield(gYield)}${pctTxt(gYield, gApplied)}` : ""}</div></div></div>
        <strong class="inv-bank-total">${fmtBRL(g.sub)}</strong>
      </div>${rows}</div>`;
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
  // cartão não aparece como opção do filtro; só fica na lista enquanto o filtro dele
  // está ativo (quando se abre "Ver transações do cartão"), para o select não ficar vazio
  const connected = connectedBanks().filter(i => i.type !== "CREDIT" || i.id === txFilterBanco);
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    connected.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  bancoSel.value = txFilterBanco;
  document.getElementById("tx-filter-tipo").value = txFilterTipo;

  const catSel = document.getElementById("tx-filter-categoria");
  catSel.innerHTML = `<option value="all">Todas categorias</option>` +
    allCategories().map(c => `<option value="${esc(c.id)}">${c.icon} ${esc(c.name)}</option>`).join("");
  catSel.value = txFilterCategoria;
}

function renderTransacoes() {
  const cbAll = connectedBanks();
  if (txFilterBanco !== "all" && cbAll.length && !cbAll.some(i => i.id === txFilterBanco)) txFilterBanco = "all";
  if (txFilterCategoria !== "all" && !allCategories().some(c => c.id === txFilterCategoria)) txFilterCategoria = "all";
  saveFilters();
  const searchEl = document.getElementById("search-transacoes");
  if (searchEl && document.activeElement !== searchEl && searchEl.value !== txSearch) searchEl.value = txSearch;
  // (as opções dos filtros são montadas quando o painel de filtros abre, não a cada digitação)
  // o botão de filtros fica destacado quando há filtro ligado (antes não dava para saber por que a lista estava menor)
  const filtrando = txFilterPeriodo !== "all" || txFilterBanco !== "all" || txFilterTipo !== "all" || txFilterCategoria !== "all";
  document.getElementById("btn-toggle-filtros")?.classList.toggle("active", filtrando);
  renderTxReviewBanner();
  renderSortSlot("tx-sort-slot", "tx");
  const allTxs = sortTxs(filterTx(state.transactions, { range: periodRange(txFilterPeriodo), banco: txFilterBanco, tipo: txFilterTipo, categoria: txFilterCategoria, search: txSearch }), sortMode.tx);
  const container = document.getElementById("tx-list-container");
  if (!allTxs.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma transação encontrada.</div>`;
    return;
  }
  const txs = allTxs.slice(0, txVisibleCount);
  // por data: título do mês, título do dia e um cartão contínuo com as transações do dia.
  // por valor: um único cartão (os dias ficariam embaralhados)
  // sempre separado por dia; em "maior/menor valor" a ordenação vale dentro de cada dia
  let html = daysHtml(txs, { months: sortMode.tx === "recent" });
  html += `<div class="tx-count-label">Mostrando ${txs.length} de ${allTxs.length} transações</div>`;
  if (allTxs.length > txVisibleCount) {
    html += `<button class="btn btn-outline" id="btn-load-more-tx">Carregar mais</button>`;
  }
  container.innerHTML = html;
}

function txDayLabel(ymd) {
  const pad = (n) => String(n).padStart(2, "0");
  const key = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const now = new Date(), ontem = new Date(now); ontem.setDate(now.getDate() - 1);
  if (ymd === key(now)) return "Hoje";
  if (ymd === key(ontem)) return "Ontem";
  const d = new Date(ymd + "T12:00:00");
  const sem = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][d.getDay()];
  return `${sem}, ${d.getDate()} de ${MONTH_NAMES[d.getMonth()].toLowerCase()}` + (d.getFullYear() !== now.getFullYear() ? ` de ${d.getFullYear()}` : "");
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
          <span class="tx-cat-chip" style="--c:${esc(cat.color || "#64748B")}"${isGuess(t) ? ' title="Sugerida pela IA — toque na transação para confirmar ou corrigir"' : ""}>${cat.icon} ${esc(cat.name)}${isGuess(t) ? ' <span class="ai-badge">IA</span>' : ""}</span>
          <span class="tx-bank-name">${esc(info.name)}</span>
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
    <div class="detalhe-cat-badge">${cat.icon} ${esc(cat.name)}</div>
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

async function deleteTx(id, similar = false) {
  const r = await api(`/transactions/${id}${similar ? "?similar=1" : ""}`, { method: "DELETE" });
  await refreshTransactions();
  closeAllModals();
  renderScreen(currentScreen);
  if (r && r.blocked) {
    showToast(`${r.deleted} transaç${r.deleted === 1 ? "ão excluída" : "ões excluídas"}. Novas com o nome "${r.name}" não entram mais. Dá para desfazer em Configurações.`, { ms: 7000 });
  }
}
// Antes de excluir, vê se existem outras com o mesmo nome e pergunta se quer excluir todas (e as próximas)
async function askDeleteTx(id) {
  let sim = { count: 0, name: "" };
  try { sim = await api(`/transactions/${id}/similar`); } catch (e) { /* segue com a exclusão simples */ }
  if (sim && sim.count > 0) {
    delSimId = id;
    document.getElementById("del-sim-name").textContent = sim.name;
    document.getElementById("del-sim-text").textContent =
      `${sim.count === 1 ? "Existe 1 outra transação" : `Existem ${sim.count} outras transações`} com esse nome. Quer excluir ${sim.count === 1 ? "ela" : "todas"} e também as próximas que chegarem com o mesmo nome? Você pode desfazer depois em Configurações › Nomes bloqueados.`;
    openModal("modal-excluir-parecidas");
    return;
  }
  if (confirm("Excluir esta transação?")) await deleteTx(id, false);
}
async function confirmDeleteSimilar(similar, btn) {
  const id = delSimId; if (id == null) return;
  await withLoading(btn, async () => {
    try { await deleteTx(id, similar); delSimId = null; }
    catch (e) { showToast("Não foi possível excluir: " + e.message, { error: true }); }
  });
}

/* ---------- nomes bloqueados (Configurações) ---------- */
async function loadBlockedNames() {
  const el = document.getElementById("blocked-list"); if (!el) return;
  try {
    const rows = await api("/blocked-names");
    el.innerHTML = rows.length
      ? rows.map(r => `<li class="blocked-item"><span class="blocked-name">${esc(r.label)}</span><button type="button" class="blocked-undo" data-unblock="${r.id}">Desbloquear</button></li>`).join("")
      : `<li class="blocked-empty">Nenhum nome bloqueado.</li>`;
  } catch (e) {
    el.innerHTML = `<li class="blocked-empty">Não foi possível carregar agora.</li>`;
  }
}
async function unblockName(id, btn) {
  await withLoading(btn, async () => {
    try {
      await api(`/blocked-names/${id}`, { method: "DELETE" });
      await loadBlockedNames();
      showToast("Nome desbloqueado. As transações dele voltam na próxima sincronização.");
      if ((state.pluggyItems || []).length) syncAllPluggy({ quiet: true }).catch(() => {});
    } catch (e) {
      showToast("Não foi possível desbloquear: " + e.message, { error: true });
    }
  }, { minMs: 300 });
}

function openCategoriaModal(txId) {
  pendingCatTxId = txId;
  const t = state.transactions.find(x => x.id === Number(txId));
  pendingCatSelected = t ? effectiveCategory(t) : null;
  const grid = document.getElementById("cat-grid");
  const cats = allCategories().filter(c => c.id !== "salario" || (t && t.type === "entrada"));
  grid.innerHTML = cats.map(c => `
    <div class="cat-grid-item ${c.id === pendingCatSelected ? "selected" : ""}" data-cat-id="${esc(c.id)}">
      ${c.id !== "outros" && c.id !== "nao_identificada" ? `
        <div class="cat-grid-actions">
          <button type="button" class="cat-mini-btn" data-edit-cat="${esc(c.id)}" title="Editar categoria" aria-label="Editar categoria">${ICONS.pencil(11)}</button>
          <button type="button" class="cat-mini-btn cat-mini-btn-danger" data-del-cat="${esc(c.id)}" title="Excluir categoria" aria-label="Excluir categoria">${ICONS.trash(11)}</button>
        </div>
      ` : ""}
      <div class="cat-icon" style="background:${c.color}">${c.icon}</div>
      ${esc(c.name)}
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
  if (sem) partes.push(`<b>${sem}</b> sem categoria`);
  if (chutes) partes.push(`<b>${chutes}</b> sugerida${chutes === 1 ? "" : "s"} pela IA`);
  el.classList.remove("hidden");
  el.innerHTML = `<span>${partes.join(" • ")}</span><button type="button" id="btn-open-revisao">Revisar</button>`;
}
function openReviewIntro(days, novas, semCat) {
  document.getElementById("revisao-title").textContent = "Vamos revisar?";
  document.getElementById("revisao-body").innerHTML = `
    <div class="rev-intro">
      <div class="rev-icon">${ICONS.list(26)}</div>
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
        <div class="rev-icon done">${ICONS.check(26)}</div>
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
  const cats = allCategories().filter(c => c.id !== "nao_identificada" && (c.id !== "salario" || t.type === "entrada"));
  body.innerHTML = `
    <div class="rev-progress"><span>${review.pos + 1} de ${total}</span><span>${cur.icon} ${esc(cur.name)}${isGuess(t) ? " · sugerida pela IA" : ""}</span></div>
    <div class="rev-bar"><i style="width:${Math.round((review.pos / total) * 100)}%"></i></div>
    ${review.note ? `<div class="rev-note">${esc(review.note)}</div>` : ""}
    <div class="rev-tx">
      <div class="rev-desc">${esc(t.desc)}</div>
      <div class="rev-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
      <div class="rev-meta">${fmtDate(t.date) || ""} • ${esc(info.name)}</div>
    </div>
    <div class="cat-grid" id="rev-grid">
      ${cats.map(c => `<div class="cat-grid-item ${c.id === t.category ? "selected" : ""}" data-rev-cat="${esc(c.id)}"><div class="cat-icon" style="background:${c.color}">${c.icon}</div>${esc(c.name)}</div>`).join("")}
      <div class="cat-grid-item cat-grid-add" id="rev-grid-add-btn">
        <div class="cat-icon cat-icon-add">+</div>
        Nova categoria
      </div>
    </div>
    <div class="rev-actions">
      ${t.category === "nao_identificada"
        ? `<button class="btn btn-outline" type="button" data-rev="skip">Pular</button>`
        : `<button class="btn btn-primary" type="button" data-rev="confirm">Está certo</button>`}
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
      review.note = r && r.applied ? `Salvo. Apliquei em mais ${r.applied} parecida${r.applied === 1 ? "" : "s"}.` : "Salvo.";
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
function curYm() { return ymdLocal(new Date()).slice(0, 7); }
function shiftYm(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function catEarliestYm() { const ms = getAvailableMonths(); return ms.length ? ms[ms.length - 1] : curYm(); }

function renderCategorias() {
  if (!catMonth) catMonth = curYm();
  saveFilters();
  document.querySelectorAll("#cat-segmented .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.seg === catSegment));
  document.getElementById("cat-view").classList.toggle("hidden", catMode !== "cats");
  document.getElementById("cat-comparar").classList.toggle("hidden", catMode !== "comparar");
  document.querySelectorAll("#cat-mode .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === catMode));
  if (catMode === "comparar") { renderComparar(); return; }

  document.getElementById("cat-month-label").innerHTML = monthLabelWithTag(catMonth);
  document.getElementById("cat-prev").disabled = catMonth <= catEarliestYm();
  document.getElementById("cat-next").disabled = catMonth >= curYm();

  const txs = state.transactions.filter(t => t.date.slice(0, 7) === catMonth && (catSegment === "gastos" ? t.type === "saida" : t.type === "entrada"));
  const total = txs.reduce((s, t) => s + Math.abs(t.value), 0);
  const byCat = {};
  txs.forEach(t => {
    const c = effectiveCategory(t);
    byCat[c] = (byCat[c] || 0) + Math.abs(t.value);
  });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  drawDonut("cat-donut", byCat, total, catSegment === "gastos" ? "gastos do mês" : "ganhos do mês");
  renderLegend("cat-legend", byCat, total);
  const el = document.getElementById("categorias-list");
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">${catSegment === "gastos" ? "Nenhum gasto" : "Nenhum ganho"} em ${esc(monthLabel(catMonth))}.</div>`;
    return;
  }
  el.innerHTML = entries.map(([cat, val]) => {
    const info = catInfo(cat);
    const pct = total ? (val / total) * 100 : 0;
    return `<div class="cat-row" data-cat="${esc(cat)}">
      <div class="cat-row-left">
        <div class="cat-icon" style="background:${info.color}">${info.icon}</div>
        <div class="cat-row-main">
          <div class="cat-name">${esc(info.name)}</div>
          <div class="cat-bar"><i style="width:${Math.max(2, pct).toFixed(1)}%;background:${info.color}"></i></div>
          <div class="cat-pct">${pct.toFixed(1).replace(".", ",")}%</div>
        </div>
      </div>
      <div class="cat-amount">${fmtBRL(val)}</div>
    </div>`;
  }).join("");
}
function changeCatMonth(delta) {
  const next = shiftYm(catMonth || curYm(), delta);
  if (next > curYm() || next < catEarliestYm()) return;
  catMonth = next;
  renderCategorias();
  animateMonthChange("cat-view", delta);
  flashLoader(450);
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
    showToast(e.message || "Não foi possível excluir a categoria.", { error: true });
  }
}

/* ============================================================
   COMPARAR MESES (dentro de Categorias)
   ============================================================ */
function populateCompareSelects() {
  const months = getAvailableMonths();
  const cur = curYm();
  if (!months.includes(cur)) months.unshift(cur);
  const c1 = document.getElementById("comp-mes1"), c2 = document.getElementById("comp-mes2");
  const p1 = c1.value, p2 = c2.value;
  const opts = months.map(m => `<option value="${m}">${esc(monthOptionLabel(m))}</option>`).join("");
  c1.innerHTML = opts; c2.innerHTML = opts;
  c1.value = months.includes(p1) ? p1 : (months[1] || months[0]);
  c2.value = months.includes(p2) ? p2 : months[0];
}
function monthByCat(ym, tipo) {
  const out = {};
  state.transactions.forEach(t => {
    if (t.date.slice(0, 7) !== ym || t.type !== tipo) return;
    const c = effectiveCategory(t);
    out[c] = (out[c] || 0) + Math.abs(t.value);
  });
  return out;
}
function renderComparar() {
  populateCompareSelects();
  document.querySelectorAll("#comp-tipo-seg .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.tipo === compTipo));
  renderCompareResult();
}
function renderCompareResult() {
  const m1 = document.getElementById("comp-mes1").value;
  const m2 = document.getElementById("comp-mes2").value;
  const el = document.getElementById("comp-resultado");
  if (!m1 || !m2 || m1 === m2) { el.innerHTML = `<div class="empty-state">Escolha dois meses diferentes para comparar.</div>`; return; }
  const c1 = monthByCat(m1, compTipo), c2 = monthByCat(m2, compTipo);
  const v1 = Object.values(c1).reduce((s, v) => s + v, 0);
  const v2 = Object.values(c2).reduce((s, v) => s + v, 0);
  if (!v1 && !v2) { el.innerHTML = `<div class="empty-state">Sem dados nesses dois meses.</div>`; return; }
  const gasto = compTipo === "saida";
  const diff = v2 - v1;
  const good = gasto ? diff <= 0 : diff >= 0;
  const pct = v1 ? Math.round(Math.abs(diff / v1) * 100) : null;
  const max = Math.max(v1, v2, 1);
  const verbo = gasto ? "gastou" : "recebeu";
  const bars = [[m1, v1, "a"], [m2, v2, "b"]].map(([m, v, k]) => `<div class="cmp-bar-row">
      <div class="cmp-bar-top"><span>${esc(monthLabel(m))}</span><b>${fmtBRL(v)}</b></div>
      <div class="cmp-bar"><i class="${k}" style="width:${Math.max(v ? 3 : 0, (v / max) * 100).toFixed(1)}%"></i></div>
    </div>`).join("");
  const cats = [...new Set([...Object.keys(c1), ...Object.keys(c2)])]
    .map(c => ({ c, a: c1[c] || 0, b: c2[c] || 0 }))
    .map(x => ({ ...x, d: x.b - x.a }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 6);
  const rows = cats.map(x => {
    const info = catInfo(x.c);
    const ok = gasto ? x.d <= 0 : x.d >= 0;
    const sign = x.d > 0 ? "+" : x.d < 0 ? "−" : "";
    return `<div class="cmp-cat" data-cat="${esc(x.c)}">
      <div class="cat-icon" style="background:${info.color}">${info.icon}</div>
      <div class="cmp-cat-main"><div class="cat-name">${esc(info.name)}</div><div class="cat-pct">${fmtBRL(x.a)} → ${fmtBRL(x.b)}</div></div>
      <div class="cmp-delta ${x.d === 0 ? "" : ok ? "good" : "bad"}">${sign}${fmtBRL(Math.abs(x.d))}</div>
    </div>`;
  }).join("");
  el.innerHTML = `<div class="comp-diff ${diff === 0 ? "" : good ? "good" : "bad"}">${diff === 0 ? "Sem diferença" : `${fmtBRL(Math.abs(diff))} ${diff > 0 ? "a mais" : "a menos"}`}</div>
    <p class="rel-frase">Em ${esc(monthLabel(m2))} você ${verbo} ${fmtBRL(v2)}. Em ${esc(monthLabel(m1))} foram ${fmtBRL(v1)}${pct !== null && diff !== 0 ? ` (${pct}% ${diff > 0 ? "a mais" : "a menos"})` : ""}.</p>
    <div class="cmp-bars">${bars}</div>
    ${rows ? `<div class="cmp-cats-title">O que mais mudou</div>${rows}` : ""}`;
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(id) { closeAllModals(); document.getElementById("toast")?.classList.remove("show"); document.getElementById(id).classList.add("active"); }

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
  if (!el.dataset.wired) { el.dataset.wired = "1"; el.addEventListener("click", () => el.classList.remove("show")); }
  toastTimer = setTimeout(() => el.classList.remove("show"), error ? Math.max(ms, 7000) : ms);
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
      applyRemotePrefs();
  applyUserToUI(state.user);
  showApp();
}

async function logoutUser() {
  clearToken();
  state.user = null; state.transactions = []; state.accounts = []; state.pluggyItems = [];
  state.investments = []; state.investHistory = []; state.customCategories = []; state.categoryOverrides = {};
  dashFilterPeriodo = "all"; dashFilterBanco = "all"; txSearch = ""; txFilterPeriodo = "all"; txFilterBanco = "all";
  txFilterTipo = "all"; txFilterCategoria = "all"; txVisibleCount = TX_PAGE_SIZE; catDetalhe = null; currentScreen = "inicio";
  sortMode = { tx: "recent", es: "recent", catdet: "recent" }; planLoadedAt = 0; lastDataFetch = 0;
  localStorage.removeItem("lastScreen");
  localStorage.removeItem(FILTERS_KEY);
  esTipo = "entrada"; catSegment = "gastos"; catMode = "cats"; planMode = "futuros"; metaOpen.clear();
  syncSig = null;
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
  renderAccentPicker(); renderNavEditor(); loadBlockedNames();
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
        ${isCard ? `<button type="button" class="acc-del" data-card-del="${esc(a.account_id)}" title="Excluir cartão" aria-label="Excluir cartão ${esc(accountLabel(a))}">${TRASH_SVG}</button>` : ""}
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
const SYNC_TIMEOUT_MS = 120000;

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
    showToast("O widget do Pluggy ainda não carregou. Verifique sua conexão e tente novamente.", { error: true });
    return;
  }

  // bolinhas no botão principal enquanto o servidor gera o token (na primeira vez pode demorar)
  await withLoading(document.getElementById("btn-pluggy-connect"), async () => {
    try {
      const { connectToken } = await api("/pluggy/connect-token", { method: "POST", timeout: 60000 });
      const pluggyConnect = new PluggyConnect({
        connectToken,
        includeSandbox: false, // false = só conectores reais (MeuPluggy e bancos); true mostra os bancos fake de teste
        onSuccess: async (itemData) => {
          showScreenLoader();
          try {
            await api("/pluggy/items", {
              method: "POST", timeout: 60000,
              body: {
                itemId: itemData.item.id,
                cpf: pluggyPendingCpf,
                institutionName: itemData.item.connector?.name || "Conta conectada"
              }
            });
            // logo após conectar, o Pluggy pode levar alguns segundos para deixar as contas
            // prontas (status "UPDATING"). O servidor já espera um pouco, mas se ainda assim
            // vier vazio, tenta de novo silenciosamente antes de desistir e mostrar "conectado".
            let r = await api(`/pluggy/sync/${itemData.item.id}`, { method: "POST", timeout: SYNC_TIMEOUT_MS });
            for (let tent = 0; !r.contasEncontradas && tent < 3; tent++) {
              await new Promise(res => setTimeout(res, 3000));
              try { r = await api(`/pluggy/sync/${itemData.item.id}`, { method: "POST", timeout: SYNC_TIMEOUT_MS }); }
              catch (e) { break; }
            }
            await refreshAfterSync();
            if (!r.contasEncontradas) {
              showToast("Conectado! O banco ainda está processando as contas — toque em \"Sincronizar\" em Minhas instituições daqui a um minuto se elas não aparecerem sozinhas.");
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
          showToast("Não foi possível concluir a conexão com o banco.", { error: true });
        }
      });
      pluggyConnect.init();
    } catch (e) {
      showToast("Erro ao iniciar conexão com o Pluggy: " + e.message, { error: true });
    }
  });
}

const syncingNow = new Set();
async function refreshAfterSync() {
  await Promise.all([refreshTransactions(), refreshAccounts(), refreshPluggyItems(), refreshInvestments()]);
  lastDataFetch = Date.now();
  renderScreen(currentScreen);
}
async function syncPluggyItem(itemId, { quiet = false } = {}) {
  if (syncingNow.has(itemId)) return null;
  syncingNow.add(itemId);
  try {
    const r = await api(`/pluggy/sync/${itemId}`, { method: "POST", timeout: SYNC_TIMEOUT_MS });
    if (!quiet) {
      await refreshAfterSync();
      let msg = `Sincronizado! ${r.novas ?? 0} nova${r.novas === 1 ? "" : "s"} • ${r.contasEncontradas} conta${r.contasEncontradas === 1 ? "" : "s"}.`;
      let isErr = false;
      if (!r.contasEncontradas) {
        isErr = true;
        msg = r.item?.status === "UPDATING"
          ? "O banco ainda está processando essa conexão. Espere um minuto e sincronize de novo."
          : `O Pluggy não devolveu nenhuma conta ainda.${r.item?.erro ? " Erro: " + r.item.erro : ""}`;
      } else if (r.erros?.length) {
        isErr = true;
        msg = `Contas atualizadas, mas não deu para ler as transações de: ${r.erros.map(x => x.split(":")[0]).join(", ")}. Tente sincronizar de novo.`;
      } else if (!r.transacoesProcessadas) {
        msg = "Contas atualizadas. O banco ainda não enviou transações; isso pode levar alguns minutos.";
      }
      showToast(msg, { error: isErr, ms: isErr ? 9000 : 5000 });
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
    showToast("Erro ao remover: " + e.message, { error: true });
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
    document.getElementById("btn-ajuda").addEventListener("click", () => showToast("Precisa de ajuda? Fale com o suporte pelo e-mail eduardo8528233@gmail.com", { ms: 9000 }));
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
    const content = document.getElementById("content");
    let sx = 0, sy = 0, tracking = false;
    content.addEventListener("touchstart", (e) => {
      if (document.querySelector(".modal-overlay.active") || e.touches.length !== 1) { tracking = false; return; }
      // não intercepta swipe dentro de áreas com rolagem horizontal própria (rolinhos de data, etc.)
      if (e.target.closest(".wheel-wrap, .cselect, .cat-month-nav, .month-year-nav")) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    content.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      const cfg = getNavCfg();
      const visible = cfg.order.filter(id => !cfg.hidden.includes(id));
      const activeId = currentScreen === "categoria-detalhe" ? "categorias" : currentScreen;
      const idx = visible.indexOf(activeId);
      if (idx === -1) return;
      const nextIdx = dx < 0 ? idx + 1 : idx - 1; // arrastou pra esquerda = próxima aba; pra direita = aba anterior
      if (nextIdx < 0 || nextIdx >= visible.length) return;
      navigateTo(visible[nextIdx], { swipeDir: dx < 0 ? "left" : "right" });
    }, { passive: true });
  }, "swipe entre telas");

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
    ["btn-ver-entradas", "btn-ver-saidas"].forEach(id => document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
    }));
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
      if (e.target.closest("#btn-load-more-es")) { esVisibleCount += ES_PAGE; renderEntradasSaidas(); return; }
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
      const delBtn = e.target.closest("[data-card-del]");
      if (delBtn) { askDeleteCard(delBtn.dataset.cardDel); return; }
      const syncBtn = e.target.closest("[data-pluggy-sync]");
      const removeBtn = e.target.closest("[data-pluggy-remove]");
      if (syncBtn) withLoading(syncBtn, () => syncPluggyItem(syncBtn.dataset.pluggySync), { minMs: 0 });
      if (removeBtn) withLoading(removeBtn, () => removePluggyItem(removeBtn.dataset.pluggyRemove));
    });
    document.getElementById("btn-confirmar-excluir-cartao")?.addEventListener("click", (e) => confirmDeleteCard(e.currentTarget));
    document.getElementById("cards-list").addEventListener("click", (e) => {
      const moreBtn = e.target.closest("[data-card-more]");
      if (moreBtn) {
        const id = moreBtn.dataset.cardMore;
        if (openCardDetails.has(id)) openCardDetails.delete(id); else openCardDetails.add(id);
        renderCards();
        return;
      }
      const delBtn = e.target.closest("[data-card-del]");
      if (delBtn) { askDeleteCard(delBtn.dataset.cardDel); return; }
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
    let txSearchTimer = null;
    document.getElementById("search-transacoes").addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(txSearchTimer);
      txSearchTimer = setTimeout(() => { txSearch = v; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); }, 180);
    });
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
      if (excluirBtn) withLoading(excluirBtn, () => askDeleteTx(excluirBtn.dataset.txId).catch(e => showToast("Não foi possível excluir: " + e.message, { error: true })), { minMs: 0 });
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
    document.getElementById("cat-mode").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn"); if (!btn) return;
      catMode = btn.dataset.mode;
      renderCategorias();
    });
    document.getElementById("cat-prev").addEventListener("click", () => changeCatMonth(-1));
    document.getElementById("cat-next").addEventListener("click", () => changeCatMonth(1));
    document.getElementById("comp-tipo-seg").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn"); if (!btn) return;
      compTipo = btn.dataset.tipo;
      document.querySelectorAll("#comp-tipo-seg .seg-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderCompareResult();
    });
    ["comp-mes1", "comp-mes2"].forEach(id => document.getElementById(id).addEventListener("change", renderCompareResult));
    document.getElementById("comp-resultado").addEventListener("click", (e) => {
      const row = e.target.closest("[data-cat]");
      if (row) { catMonth = document.getElementById("comp-mes2").value || catMonth; catSegment = compTipo === "saida" ? "gastos" : "ganhos"; openCategoriaDetalhe(row.dataset.cat); }
    });
  }, "comparar meses");

  wire(() => {
    document.getElementById("plan-mode").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn"); if (!btn) return;
      planMode = btn.dataset.pmode;
      renderPlanejamento();
    });
    document.getElementById("plan-prev").addEventListener("click", () => changePlanMonth(-1));
    document.getElementById("plan-next").addEventListener("click", () => changePlanMonth(1));
    document.getElementById("btn-novo-planejado").addEventListener("click", (e) => { e.preventDefault(); openPlanModal(null); });
    document.getElementById("plan-tipo-seg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn"); if (!b) return;
      document.querySelectorAll("#plan-tipo-seg .seg-btn").forEach(x => x.classList.toggle("active", x === b));
    });
    document.getElementById("plan-categoria").addEventListener("change", refreshSubtitleOptions);
    document.getElementById("plan-categoria-trigger").addEventListener("click", () => toggleCSelect("plan-categoria-cselect"));
    document.getElementById("plan-categoria-panel").addEventListener("click", (e) => {
      const btn = e.target.closest(".cselect-option"); if (!btn) return;
      const sel = document.getElementById("plan-categoria");
      sel.value = btn.dataset.value;
      sel.dispatchEvent(new Event("change"));
      renderCategoriaCSelect(sel.value);
      closeAllCSelects();
    });
    document.getElementById("plan-subtitulo-trigger").addEventListener("click", () => toggleCSelect("plan-subtitulo-cselect"));
    document.getElementById("plan-subtitulo-panel").addEventListener("click", (e) => {
      if (e.target.closest("#btn-add-subtitulo")) { addSubtituloInline(); return; }
      const btn = e.target.closest(".cselect-option"); if (!btn) return;
      document.getElementById("plan-subtitulo").value = btn.dataset.value;
      refreshSubtitleOptions();
      closeAllCSelects();
    });
    document.getElementById("plan-subtitulo-panel").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "plan-subtitulo-novo") { e.preventDefault(); addSubtituloInline(); }
    });
    document.getElementById("plan-varios-meses-check").addEventListener("change", (e) => {
      planVariosMeses = e.target.checked;
      document.getElementById("plan-qtd-row").classList.toggle("hidden", !planVariosMeses);
    });
    document.getElementById("plan-qtd-minus").addEventListener("click", () => {
      planQtdMeses = Math.max(1, planQtdMeses - 1);
      document.getElementById("plan-qtd-value").textContent = planQtdMeses;
    });
    document.getElementById("plan-qtd-plus").addEventListener("click", () => {
      planQtdMeses = Math.min(36, planQtdMeses + 1);
      document.getElementById("plan-qtd-value").textContent = planQtdMeses;
    });
    document.getElementById("btn-salvar-planejado").addEventListener("click", (e) => withLoading(e.currentTarget, savePlanejado));
    document.getElementById("plan-list").addEventListener("click", (e) => {
      const row = e.target.closest("[data-plan-id]"); if (!row) return;
      const id = row.dataset.planId;
      if (e.target.closest("[data-plan-pay]")) return askMarkPaid(id);
      if (e.target.closest("[data-plan-unpay]")) return unpayPlanItem(id);
      if (e.target.closest("[data-plan-edit]")) return openPlanModal(id);
      if (e.target.closest("[data-plan-del]")) return deletePlanItem(id);
    });
    document.getElementById("btn-confirmar-pago").addEventListener("click", (e) => confirmMarkPaid(e.currentTarget)); // confirmMarkPaid já mostra o anel de carregamento (antes o anel era aplicado duas vezes e o clique não fazia nada)

    document.getElementById("metas-list").addEventListener("click", (e) => {
      const subToggle = e.target.closest("[data-sub-toggle]");
      if (subToggle) {
        const cid = subToggle.dataset.subToggle;
        if (metaOpen.has(cid)) metaOpen.delete(cid); else metaOpen.add(cid);
        subToggle.classList.toggle("open", metaOpen.has(cid));
        const list = document.getElementById(`meta-sub-list-${cid}`);
        if (list) list.classList.toggle("open", metaOpen.has(cid));
        return;
      }
      if (e.target.closest(".meta-sub-list")) return; // tocar nos itens não abre a edição da meta
      const def = e.target.closest("[data-meta-def]");
      if (def) return openMetaModal(def.dataset.metaDef);
      const row = e.target.closest("[data-meta-edit]");
      if (row) return openMetaModal(row.dataset.metaEdit);
    });
    document.getElementById("meta-tipo-seg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn"); if (!b) return;
      document.querySelectorAll("#meta-tipo-seg .seg-btn").forEach(x => x.classList.toggle("active", x === b));
      document.getElementById("meta-meses-grid").classList.toggle("hidden", b.dataset.metatipo !== "especifico");
    });
    document.getElementById("meta-meses-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".month-check"); if (!b) return;
      b.classList.toggle("active");
    });
    document.getElementById("btn-salvar-meta").addEventListener("click", (e) => withLoading(e.currentTarget, saveMeta));
    document.getElementById("btn-remover-meta").addEventListener("click", (e) => withLoading(e.currentTarget, removeMeta));
  }, "planejamento");

  wire(() => {
    document.getElementById("btn-del-sim-all").addEventListener("click", (e) => confirmDeleteSimilar(true, e.currentTarget));
    document.getElementById("btn-del-sim-one").addEventListener("click", (e) => confirmDeleteSimilar(false, e.currentTarget));
    document.getElementById("blocked-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unblock]");
      if (b) unblockName(b.dataset.unblock, b);
    });
  }, "excluir parecidas");

  wire(async () => {
    const token = getToken();
    if (!token) { showLogin(); return; }
    const open = async () => {
      await refreshAll();
      applyTheme(state.preferences.theme || "light");
      localStorage.setItem(THEME_CACHE_KEY, state.preferences.theme || "light");
      applyRemotePrefs();
      applyUserToUI(state.user);
      showApp();
    };
    try {
      await open();
    } catch (e) {
      // sessão vencida (401): api() já limpou o token e mostrou o login. Qualquer outro erro é
      // rede ou servidor acordando: tenta mais uma vez e, se falhar, mantém a sessão salva.
      if (!getToken()) return;
      await sleep(3000);
      try { await open(); }
      catch (e2) {
        if (!getToken()) return;
        showLogin();
        showToast("Não consegui falar com o servidor agora. Sua sessão foi mantida: recarregue a página em instantes.", { error: true, ms: 9000 });
      }
    }
  }, "boot");

  wire(initGoogleLogin, "Google Sign-In");
});


// Botão de ordenar por valor (Transações, Entradas/Saídas e detalhe da categoria)
document.addEventListener("DOMContentLoaded", () => {
  wire(() => {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sort]"); if (!b) return;
      const key = b.dataset.sort;
      sortMode[key] = SORT_CYCLE[(SORT_CYCLE.indexOf(sortMode[key]) + 1) % SORT_CYCLE.length];
      if (key === "tx") { txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); }
      else if (key === "es") renderEntradasSaidas();
      else if (key === "catdet") renderCategoriaDetalhe();
    });
  }, "ordenação por valor");
});

/* ============================================================
   VALORES SUBINDO: todo "R$ 0,00" que aparece na tela sobe de 0 até o valor final.
   Observa o que o app desenha e anima só o que está visível (sem mexer nas funções de render).
   ============================================================ */
(() => {
  const HAS = /R\$[\s\u00a0]?\d{1,3}(?:\.\d{3})*,\d{2}/;
  const RE = /(R\$[\s\u00a0]?)(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const BRL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const DUR = 1100, MAX_NODES = 60, SKIP = ".modal-overlay, .toast, [data-no-count]";
  let pending = [], raf = 0, running = [], ticking = false;

  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const parse = (n) => parseFloat(n.replace(/\./g, "").replace(",", "."));
  const frame = (final, e) => final.replace(RE, (m, pre, num) => pre + BRL.format(parse(num) * e));

  function collect(node, out) {
    if (node.nodeType === 3) {
      if (HAS.test(node.nodeValue) && !node.parentElement?.closest(SKIP)) out.push(node);
      return;
    }
    if (node.nodeType !== 1 || node.closest(SKIP)) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (HAS.test(n.nodeValue)) out.push(n);
  }
  function inView(n) {
    const el = n.parentElement;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }
  function flush() {
    raf = 0;
    const batch = pending; pending = [];
    if (!introAnim || reduced() || Date.now() < noCountUntil) return;
    const nodes = [];
    batch.forEach(n => { if (n.isConnected) collect(n, nodes); });
    const vis = nodes.filter(inView).slice(0, MAX_NODES);
    const now = performance.now();
    vis.forEach((node, i) => {
      running = running.filter(r => r.node !== node);
      const final = node.nodeValue;
      node.nodeValue = frame(final, 0);           // já começa em zero, antes de pintar
      running.push({ node, final, t0: now + Math.min(i * 25, 200) });
    });
    if (running.length && !ticking) { ticking = true; requestAnimationFrame(tick); }
  }
  function tick(now) {
    running = running.filter(r => {
      if (!r.node.isConnected) return false;
      const p = Math.min(1, Math.max(0, (now - r.t0) / DUR));
      r.node.nodeValue = p >= 1 ? r.final : frame(r.final, 1 - Math.pow(1 - p, 3));
      return p < 1;
    });
    if (running.length) requestAnimationFrame(tick); else ticking = false;
  }
  document.addEventListener("DOMContentLoaded", () => {
    const content = document.getElementById("content");
    if (!content || !("MutationObserver" in window)) return;
    new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => pending.push(n)));
      if (!raf) raf = requestAnimationFrame(flush);
    }).observe(content, { childList: true, subtree: true });
  });
})();

/* ============================================================
   SINCRONIZAÇÃO ENTRE APARELHOS
   A cada ~15 s (com o app aberto) pergunta ao servidor uma "assinatura" barata dos seus dados.
   Se mudou em outro aparelho, baixa tudo e redesenha a tela sozinho (sem animar os valores de novo).
   Também confere na hora ao voltar para o app, quando a internet volta e depois das suas alterações.
   ============================================================ */
let syncSig = null, syncBusy = false, syncBaseTimer = null, noCountUntil = 0, pushUiTimer = null;
const SYNC_EVERY_MS = 15000;

function userIsBusy() { return !!document.querySelector(".modal-overlay.active, .cselect-panel.open"); }
async function fetchSyncSig() { const r = await api("/sync-state", { silent: true, timeout: 20000 }); return r.sig; }

// depois de uma alteração feita AQUI, guarda a nova assinatura para ela não ser confundida com mudança de outro aparelho
function scheduleSyncBaseline() {
  if (!state.user) return;
  clearTimeout(syncBaseTimer);
  syncBaseTimer = setTimeout(async () => {
    if (syncBusy || !state.user) return;
    try { syncSig = await fetchSyncSig(); } catch (e) { /* sem internet: o próximo ciclo resolve */ }
  }, 500);
}

async function syncCheck() {
  if (!state.user || syncBusy || document.visibilityState !== "visible" || dataFetching || autoSyncing) return;
  syncBusy = true;
  try {
    const sig = await fetchSyncSig();
    if (syncSig === null) { syncSig = sig; return; }
    if (sig === syncSig) return;
    if (userIsBusy()) return; // não redesenha por baixo de uma janela aberta; tenta de novo no próximo ciclo
    syncSig = sig;
    noCountUntil = Date.now() + 1500;
    await Promise.all([refreshMe(), refreshTransactions(), refreshAccounts(), refreshPluggyItems(), refreshCategories(), refreshInvestments(), loadPlanData()]);
    lastDataFetch = Date.now(); planLoadedAt = Date.now();
    if (!state.user) return;
    applyRemotePrefs();
    renderScreen(currentScreen);
  } catch (e) { /* silencioso: é só uma checagem em segundo plano */ }
  finally { syncBusy = false; }
}

// tema, cor do app e abas de baixo acompanham a conta
function applyRemotePrefs() {
  const p = state.preferences || {};
  if (p.theme && p.theme !== (document.documentElement.getAttribute("data-theme") || "light")) {
    applyTheme(p.theme); localStorage.setItem(THEME_CACHE_KEY, p.theme);
  }
  try {
    const ui = p.ui ? JSON.parse(p.ui) : null;
    if (!ui) return;
    if (ui.accent && ACCENTS[ui.accent]) localStorage.setItem("accent", ui.accent);
    if (ui.navCfg && Array.isArray(ui.navCfg.order)) localStorage.setItem("navCfg", JSON.stringify(ui.navCfg));
    applyAccent(); renderBottomNav();
  } catch (e) { /* configuração ilegível: mantém a atual */ }
}
function pushUiPrefs() {
  if (!state.user) return;
  clearTimeout(pushUiTimer);
  pushUiTimer = setTimeout(async () => {
    const ui = JSON.stringify({ accent: currentAccent(), navCfg: getNavCfg() });
    try { await api("/me/ui", { method: "PUT", body: { ui } }); state.preferences.ui = ui; }
    catch (e) { console.warn("não foi possível salvar a aparência na conta", e.message); }
  }, 600);
}

setInterval(syncCheck, SYNC_EVERY_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(syncCheck, 400); });
window.addEventListener("online", () => syncCheck());
window.addEventListener("focus", () => setTimeout(syncCheck, 300));



/* ============================================================
   TUTORIAL DO APP
   - "Passo a passo": telas que você avança (abre sozinho na 1ª vez).
   - "Guia": seções que abrem e fecham, para consultar quando quiser.
   Botão em Créditos › Como usar o Fluxo.
   ============================================================ */
const TUT_KEY = "fluxo_tutorial_visto";
const TUT_STEPS = [
  { ico: "👋", t: "Bem-vindo ao Fluxo", p: "Seu dinheiro, em movimento. Em poucos passos você vê como o app junta seus bancos, organiza seus gastos e ajuda a planejar o mês.",
    b: ["Abas de baixo: Início, Transações, Investimentos, Categorias e Planejamento", "Deslize para os lados para trocar de aba", "Você revê este tutorial quando quiser em Créditos"] },
  { ico: "🏦", t: "Conecte seus bancos", p: "Toque na sua foto (canto de cima) e abra Minhas instituições.",
    b: ["Toque em Conectar banco real (Pluggy) e siga os passos do banco", "O app só lê os dados: nunca guarda a sua senha", "Use Sincronizar todos os bancos para buscar novidades", "Dá para conectar contas de mais de um CPF"] },
  { ico: "🏠", t: "Início", p: "Sua visão geral: saldo total, quanto entrou e quanto saiu.",
    b: ["O olho esconde os valores na hora, útil em público", "Os filtros de cima escolhem o período e o banco", "Seus bancos e cartões aparecem logo abaixo"] },
  { ico: "↕️", t: "Entradas e Saídas", p: "No Início, toque em Entradas ou em Saídas para ver a lista completa.",
    b: ["Tudo separado por dia, com o total de cada dia", "O botão de ordenação coloca os maiores valores primeiro, sem misturar os dias", "Toque numa movimentação para ver os detalhes"] },
  { ico: "🧾", t: "Transações", p: "Todas as movimentações em um só lugar, separadas por dia.",
    b: ["Busque pelo nome e use o ícone de filtro para período, banco, tipo e categoria", "Toque numa transação para ver detalhes, trocar a categoria ou excluir", "Categorias com o selo IA foram sugeridas automaticamente: confirme ou corrija"] },
  { ico: "🍩", t: "Categorias", p: "Veja para onde o dinheiro foi (Gastos) e de onde ele veio (Ganhos).",
    b: ["As setas trocam de mês", "Toque numa categoria para ver as transações dela, por dia", "Em Comparar meses você vê a diferença entre dois meses"] },
  { ico: "📈", t: "Investimentos", p: "Acompanhe o que está aplicado e quanto rendeu.",
    b: ["Aplicado, Valor atual e Rendeu no topo", "A barra colorida mostra quanto está em cada banco", "Rendeu = valor de hoje menos o que você aplicou"] },
  { ico: "🗓️", t: "Planejamento", p: "Anote os gastos e ganhos que ainda vão acontecer no mês.",
    b: ["Toque em Novo para planejar um item", "Toque no círculo do item para marcar como pago (toque de novo para desfazer)", "Isso vale só para o planejamento e não mexe no saldo real da conta"] },
  { ico: "🎯", t: "Metas por categoria", p: "Em Planejamento, abra Metas por categoria e defina quanto quer gastar em cada uma.",
    b: ["A barra mostra o que já foi pago dentro do que foi planejado", "Ver por subtítulo mostra cada item, com check e riscado quando pago", "Metas fixas valem todo mês; ou escolha meses específicos"] },
  { ico: "⚙️", t: "Deixe do seu jeito", p: "No menu da sua foto, abra Configurações.",
    b: ["Escolha a cor do app e o modo escuro", "Mude a ordem das abas de baixo e esconda as que não usa", "Nomes bloqueados: desbloqueie transações que você excluiu por engano", "Seus filtros e preferências ficam salvos ao recarregar"] }
];
const TUT_GUIDE = [
  { ico: "🏦", t: "Primeiros passos", items: [
    "Toque na sua foto, abra Minhas instituições e conecte o banco pelo Pluggy (Open Finance).",
    "O app só lê os dados, nunca guarda a sua senha.",
    "Depois de conectar, use Sincronizar todos os bancos para trazer as transações.",
    "O app também sincroniza sozinho de vez em quando."] },
  { ico: "🏠", t: "Início", items: [
    "Saldo total no topo. O olho esconde ou mostra os valores.",
    "Os cartões Entradas e Saídas abrem a lista completa, separada por dia.",
    "Filtros de período e banco ficam salvos quando você recarrega a página.",
    "Seus bancos e cartões aparecem mais abaixo. Toque num cartão para ver as transações dele."] },
  { ico: "🧾", t: "Transações", items: [
    "Sempre separadas por dia.",
    "Busca pelo nome e filtro por período, banco, tipo e categoria (ícone ao lado da busca).",
    "O botão de ordenação alterna entre mais recentes, maior valor e menor valor. Os dias continuam separados.",
    "Toque numa transação: detalhes, Alterar categoria ou Excluir.",
    "Ao trocar a categoria, o app pode aplicar a mesma escolha em transações parecidas.",
    "Ao excluir, o app pergunta se quer excluir também as parecidas e bloquear o nome. Dá para desfazer em Configurações › Nomes bloqueados."] },
  { ico: "🍩", t: "Categorias", items: [
    "Alterne entre Gastos e Ganhos. As setas trocam de mês.",
    "Toque numa categoria para ver as transações dela, separadas por dia.",
    "Comparar meses mostra a diferença entre dois meses.",
    "Você pode criar, editar e excluir categorias ao escolher a categoria de uma transação."] },
  { ico: "📈", t: "Investimentos", items: [
    "Total investido, quanto foi aplicado e quanto rendeu.",
    "A barra colorida mostra a divisão entre os bancos.",
    "Cada banco lista os investimentos com o valor aplicado e o rendimento."] },
  { ico: "🗓️", t: "Planejamento: gastos futuros", items: [
    "Use as setas para escolher o mês. Cada mês começa zerado.",
    "O resumo mostra o que sobra (ou falta) e a divisão entre ganhos e gastos planejados.",
    "Novo cria um item. O lápis edita e a lixeira exclui.",
    "O círculo marca como pago. Toque de novo para desfazer.",
    "Nada disso altera o saldo real da conta."] },
  { ico: "🎯", t: "Planejamento: metas por categoria", items: [
    "Defina quanto quer gastar por categoria no mês.",
    "A barra escura mostra o que foi pago e a clara mostra o planejado.",
    "Ver por subtítulo abre os itens: pagos ficam com check e riscados.",
    "Meta fixa vale todo mês; meses específicos valem só para os meses escolhidos."] },
  { ico: "⚙️", t: "Configurações e dicas", items: [
    "Cor do app, modo escuro e ordem das abas de baixo.",
    "Nomes bloqueados: desbloqueie o que foi excluído por engano.",
    "Se algo parecer desatualizado, feche e abra o app ou recarregue a página.",
    "Este tutorial fica sempre disponível em Créditos."] }
];
let tutIdx = 0;
function tutStepHtml() {
  const st = TUT_STEPS[tutIdx], last = tutIdx === TUT_STEPS.length - 1;
  return `<div class="tut-slide" key="${tutIdx}">
      <div class="tut-ico" aria-hidden="true">${st.ico}</div>
      <h4 class="tut-title">${st.t}</h4>
      <p class="tut-text">${st.p}</p>
      <ul class="tut-list">${st.b.map(x => `<li>${x}</li>`).join("")}</ul>
    </div>
    <div class="tut-dots" role="tablist">${TUT_STEPS.map((_, i) => `<button type="button" class="tut-dot${i === tutIdx ? " on" : ""}" data-tut-go="${i}" aria-label="Passo ${i + 1}"></button>`).join("")}</div>
    <div class="tut-nav">
      <button type="button" class="btn btn-outline tut-prev"${tutIdx === 0 ? " disabled" : ""} data-tut-prev>Voltar</button>
      <span class="tut-count">${tutIdx + 1} de ${TUT_STEPS.length}</span>
      <button type="button" class="btn btn-primary tut-next" data-tut-next>${last ? "Concluir" : "Próximo"}</button>
    </div>`;
}
function renderTutorial() {
  document.getElementById("tut-passos").innerHTML = tutStepHtml();
  const g = document.getElementById("tut-guia");
  if (!g.dataset.ready) {
    g.innerHTML = TUT_GUIDE.map(sec => `<details class="tut-sec"><summary><span class="tut-sec-ico">${sec.ico}</span><span>${sec.t}</span></summary><ul>${sec.items.map(x => `<li>${x}</li>`).join("")}</ul></details>`).join("");
    g.dataset.ready = "1";
  }
}
function tutTab(tab) {
  document.querySelectorAll("#tut-tabs .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.tuttab === tab));
  document.getElementById("tut-passos").classList.toggle("hidden", tab !== "passos");
  document.getElementById("tut-guia").classList.toggle("hidden", tab !== "guia");
}
function openTutorial(tab = "passos") {
  try { localStorage.setItem(TUT_KEY, "1"); } catch (e) { /* sem armazenamento: só não lembra que já viu */ }
  tutIdx = 0;
  renderTutorial(); tutTab(tab);
  openModal("modal-tutorial");
  const body = document.querySelector("#modal-tutorial .modal-body"); if (body) body.scrollTop = 0;
}
function maybeAutoTutorial() {
  let seen = "1";
  try { seen = localStorage.getItem(TUT_KEY); } catch (e) { /* ignora */ }
  if (seen || !state.user) return;
  if (document.querySelector(".modal-overlay.active")) return; // não atropela outro aviso aberto
  openTutorial("passos");
}
document.addEventListener("DOMContentLoaded", () => {
  wire(() => {
    document.getElementById("btn-tutorial").addEventListener("click", () => openTutorial("passos"));
    document.getElementById("tut-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tuttab]"); if (b) tutTab(b.dataset.tuttab); });
    document.getElementById("tut-passos").addEventListener("click", (e) => {
      if (e.target.closest("[data-tut-next]")) {
        if (tutIdx >= TUT_STEPS.length - 1) { closeAllModals(); return; }
        tutIdx++; renderTutorial(); return;
      }
      if (e.target.closest("[data-tut-prev]")) { if (tutIdx > 0) { tutIdx--; renderTutorial(); } return; }
      const go = e.target.closest("[data-tut-go]"); if (go) { tutIdx = Number(go.dataset.tutGo) || 0; renderTutorial(); }
    });
  }, "tutorial");
});
