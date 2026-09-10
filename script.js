/* ============================================================
   FinanHub — app.js
   Dados salvos em localStorage. Estrutura pensada para no futuro
   ser trocada por chamadas a um backend real (SQLite/PostgreSQL)
   e integração oficial com Open Finance.
   ============================================================ */

const GOOGLE_CLIENT_ID = "732987980412-3caubvvgvknj05hpl5mb5p2lcfs3b3pm.apps.googleusercontent.com";

const LS_KEYS = {
  user: "fh_user",
  institutions: "fh_institutions",
  transactions: "fh_transactions",
  categoryOverrides: "fh_category_overrides"
};

const ALL_INSTITUTIONS = [
  { id: "inter", name: "Banco Inter", color: "#FF7A00" },
  { id: "bb", name: "Banco do Brasil", color: "#FFCC29" },
  { id: "caixa", name: "Caixa Econômica", color: "#0072CE" },
  { id: "nubank", name: "Nubank", color: "#820AD1" },
  { id: "itau", name: "Itaú", color: "#EC7000" },
  { id: "bradesco", name: "Bradesco", color: "#CC092F" },
  { id: "santander", name: "Santander", color: "#EC0000" },
  { id: "brb", name: "BRB", color: "#0033A0" },
  { id: "c6", name: "C6 Bank", color: "#1A1A1A" },
  { id: "btg", name: "BTG", color: "#0A0A0A" },
  { id: "mp", name: "Mercado Pago", color: "#00A9E0" },
  { id: "sicoob", name: "Sicoob", color: "#00A651" },
  { id: "sicredi", name: "Sicredi", color: "#7AB800" }
];

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

const CATEGORY_RULES = [
  { match: ["ifood", "restaurante", "mercado", "supermercado", "padaria"], cat: "alimentacao" },
  { match: ["uber", "99", "posto", "combustivel", "combustível"], cat: "transporte" },
  { match: ["netflix", "steam", "spotify", "disney", "hbo", "prime video"], cat: "entretenimento" },
  { match: ["farmacia", "farmácia", "drogaria", "hospital", "clinica", "clínica"], cat: "saude" },
  { match: ["luz", "agua", "água", "internet", "telefone", "condominio", "condomínio", "energia"], cat: "contas" },
  { match: ["escola", "curso", "faculdade", "udemy"], cat: "educacao" },
  { match: ["salario", "salário", "pix recebido", "pagamento recebido"], cat: "salario" },
  { match: ["amazon", "shopee", "magazine", "loja"], cat: "compras" }
];

function categorize(desc) {
  const d = desc.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.match.some(k => d.includes(k))) return rule.cat;
  }
  return "nao_identificada";
}

function catInfo(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}
function instInfo(id) {
  return ALL_INSTITUTIONS.find(i => i.id === id) || { name: id, color: "#94A3B8" };
}
function fmtBRL(v) {
  const sign = v < 0 ? "-" : "";
  return sign + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function initials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ============================================================
   PERSISTENCE LAYER (troque por chamadas de API no futuro)
   ============================================================ */
const store = {
  getUser() { return JSON.parse(localStorage.getItem(LS_KEYS.user) || "null"); },
  setUser(u) { localStorage.setItem(LS_KEYS.user, JSON.stringify(u)); },
  clearUser() { localStorage.removeItem(LS_KEYS.user); },

  getInstitutions() { return JSON.parse(localStorage.getItem(LS_KEYS.institutions) || "null") || defaultInstitutions(); },
  setInstitutions(list) { localStorage.setItem(LS_KEYS.institutions, JSON.stringify(list)); },

  getTransactions() { return JSON.parse(localStorage.getItem(LS_KEYS.transactions) || "[]"); },
  setTransactions(list) { localStorage.setItem(LS_KEYS.transactions, JSON.stringify(list)); },

  getOverrides() { return JSON.parse(localStorage.getItem(LS_KEYS.categoryOverrides) || "{}"); },
  setOverrides(o) { localStorage.setItem(LS_KEYS.categoryOverrides, JSON.stringify(o)); }
};

function defaultInstitutions() {
  const connectedIds = ["inter", "nubank"];
  return ALL_INSTITUTIONS.map(i => ({ ...i, connected: connectedIds.includes(i.id) }));
}

/* ============================================================
   DEMO DATA GENERATOR
   ============================================================ */
function generateDemoData() {
  const banks = ["inter", "nubank", "caixa", "bb"];
  const outDescs = [
    ["IFOOD", "alimentacao"], ["UBER", "transporte"], ["STEAM", "entretenimento"],
    ["NETFLIX", "entretenimento"], ["POSTO SHELL", "transporte"], ["MERCADO EXTRA", "alimentacao"],
    ["FARMACIA SP", "saude"], ["AMAZON", "compras"], ["CONTA DE LUZ", "contas"],
    ["INTERNET FIBRA", "contas"], ["RESTAURANTE", "alimentacao"], ["SHOPEE", "compras"],
    ["CURSO ONLINE", "educacao"], ["ACADEMIA", "saude"]
  ];
  const inDescs = ["PIX recebido", "Salário", "Pagamento recebido"];

  const txs = [];
  let id = 1;
  const now = new Date(2026, 0, 1); // referência: Janeiro 2026
  for (let m = 0; m < 14; m++) { // ~14 meses de histórico até jan/2026
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const numTx = 8 + Math.floor(Math.random() * 6);
    // entrada de salário garantida
    banks.forEach(bank => {
      txs.push(mkTx(id++, year, month, 1 + Math.floor(Math.random()*3), "Salário", bank, roundVal(1800 + Math.random()*1500), "entrada", "salario"));
    });
    for (let i = 0; i < numTx; i++) {
      const bank = banks[Math.floor(Math.random() * banks.length)];
      const day = 1 + Math.floor(Math.random() * 27);
      if (Math.random() < 0.12) {
        const desc = inDescs[Math.floor(Math.random() * inDescs.length)];
        txs.push(mkTx(id++, year, month, day, desc, bank, roundVal(50 + Math.random()*400), "entrada", "salario"));
      } else {
        const [desc, cat] = outDescs[Math.floor(Math.random() * outDescs.length)];
        txs.push(mkTx(id++, year, month, day, desc, bank, roundVal(15 + Math.random()*280), "saida", cat));
      }
    }
  }
  txs.sort((a,b) => b.date.localeCompare(a.date));
  store.setTransactions(txs);
  store.setInstitutions(ALL_INSTITUTIONS.map(i => ({ ...i, connected: banks.includes(i.id) })));
  store.setOverrides({});
}
function roundVal(v) { return Math.round(v * 100) / 100; }
function mkTx(id, year, month, day, desc, bank, value, type, cat) {
  const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  return { id, date: dateStr, desc, bank, value: type === "saida" ? -Math.abs(value) : Math.abs(value), type, category: cat };
}

/* ============================================================
   APP STATE
   ============================================================ */
let currentScreen = "inicio";
let dashFilterPeriodo = "all"; // "YYYY-MM" or "all"
let dashFilterBanco = "all";
let txSearch = "";
let txFilterBanco = "all";
let txFilterTipo = "all";
let catSegment = "gastos";
let relSegment = "geral";
let pendingCatTxId = null;
let pendingCatSelected = null;
const TX_PAGE_SIZE = 10;
let txVisibleCount = TX_PAGE_SIZE;

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
  if (target) target.classList.add("active");
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
  const txs = store.getTransactions();
  const set = new Set(txs.map(t => t.date.slice(0,7)));
  return Array.from(set).sort().reverse();
}
function filterTx(txs, { periodo, banco, tipo, search } = {}) {
  return txs.filter(t => {
    if (periodo && periodo !== "all" && t.date.slice(0,7) !== periodo) return false;
    if (banco && banco !== "all" && t.bank !== banco) return false;
    if (tipo && tipo !== "all" && t.type !== tipo) return false;
    if (search && !t.desc.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
}
function effectiveCategory(t) {
  const overrides = store.getOverrides();
  return overrides[t.id] || t.category;
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
  const institutions = store.getInstitutions().filter(i => i.connected);
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
  const txs = filterTx(store.getTransactions(), { periodo: dashFilterPeriodo, banco: dashFilterBanco });
  const entradas = txs.filter(t => t.type === "entrada").reduce((s,t) => s + t.value, 0);
  const saidas = txs.filter(t => t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);
  const saldo = entradas - saidas;

  document.getElementById("balance-total").textContent = fmtBRL(saldo);
  document.getElementById("total-entradas").textContent = fmtBRL(entradas);
  document.getElementById("total-saidas").textContent = fmtBRL(saidas);
  document.getElementById("balance-change").textContent = txs.length ? `${txs.length} transações no período` : "Nenhuma transação no período";

  // bancos
  const institutions = store.getInstitutions().filter(i => i.connected);
  const allTx = store.getTransactions();
  const banksScroll = document.getElementById("banks-scroll");
  banksScroll.innerHTML = institutions.map(i => {
    const bal = allTx.filter(t => t.bank === i.id).reduce((s,t) => s + t.value, 0);
    return `<div class="bank-chip">
      <div class="bank-icon" style="background:${i.color}">${initials(i.name)}</div>
      <div class="bank-amount">${fmtBRL(bal)}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${i.name}</div>
    </div>`;
  }).join("") || `<div class="empty-state">Nenhum banco conectado ainda.</div>`;

  // donut chart — gastos por categoria
  const saidasTx = txs.filter(t => t.type === "saida");
  const byCat = {};
  saidasTx.forEach(t => {
    const c = effectiveCategory(t);
    byCat[c] = (byCat[c] || 0) + Math.abs(t.value);
  });
  drawDonut("donut-chart", byCat, saidas);
  renderLegend("donut-legend", byCat, saidas);
}

function drawDonut(canvasId, byCat, total) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, rOuter = Math.min(w,h)/2 - 6, rInner = rOuter * 0.62;
  if (!total || Object.keys(byCat).length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI*2);
    ctx.fillStyle = "#EEF2F8";
    ctx.fill();
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = "#6B7A90";
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
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.font = "700 15px Inter, sans-serif";
  ctx.fillStyle = "#14213D";
  ctx.textAlign = "center";
  ctx.fillText(fmtBRL(total), cx, cy+2);
  ctx.font = "600 11px Inter, sans-serif";
  ctx.fillStyle = "#6B7A90";
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
      <div class="legend-left"><span class="legend-dot" style="background:${info.color}"></span>${info.name}</div>
      <div><span class="legend-pct">${pct}%</span> &nbsp; ${fmtBRL(val)}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   BANCOS
   ============================================================ */
function renderBancos() {
  const institutions = store.getInstitutions();
  const el = document.getElementById("banks-list");
  el.innerHTML = institutions.map(i => `
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

function toggleBankConnection(id) {
  const institutions = store.getInstitutions();
  const updated = institutions.map(i => i.id === id ? { ...i, connected: !i.connected } : i);
  store.setInstitutions(updated);
  renderBancos();
}

function openAddInstModal() {
  const institutions = store.getInstitutions();
  const el = document.getElementById("add-inst-list");
  el.innerHTML = institutions.map(i => `
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
  const connected = store.getInstitutions().filter(i => i.connected);
  bancoSel.innerHTML = `<option value="all">Todos os bancos</option>` +
    connected.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
  bancoSel.value = txFilterBanco;
  document.getElementById("tx-filter-tipo").value = txFilterTipo;
}

function renderTransacoes() {
  populateTxFilters();
  const allTxs = filterTx(store.getTransactions(), { banco: txFilterBanco, tipo: txFilterTipo, search: txSearch })
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
  const info = instInfo(t.bank);
  const isPos = t.value >= 0;
  return `<div class="tx-row" data-tx-id="${t.id}">
    <div class="tx-row-left">
      <div class="tx-icon" style="background:${info.color}">${initials(t.desc.split(" ")[0])}</div>
      <div>
        <div class="tx-desc">${t.desc}</div>
        <div class="tx-meta">${info.name} • ${isPos ? "Entrada" : "Saída"}</div>
      </div>
    </div>
    <div class="tx-value ${isPos ? "pos" : "neg"}">${isPos ? "+ " : "- "}${fmtBRL(Math.abs(t.value))}</div>
  </div>`;
}

function openTxDetalhe(id) {
  const t = store.getTransactions().find(x => x.id === Number(id));
  if (!t) return;
  const info = instInfo(t.bank);
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
    <button class="btn btn-primary" id="btn-alterar-categoria" data-tx-id="${t.id}">Alterar categoria</button>
    <button class="btn btn-danger" id="btn-excluir-tx" data-tx-id="${t.id}">Excluir</button>
  `;
  openModal("modal-detalhe");
}

function deleteTx(id) {
  const txs = store.getTransactions().filter(t => t.id !== Number(id));
  store.setTransactions(txs);
  closeAllModals();
  renderScreen(currentScreen);
}

function openCategoriaModal(txId) {
  pendingCatTxId = txId;
  const t = store.getTransactions().find(x => x.id === Number(txId));
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
function saveCategoria() {
  if (pendingCatTxId == null || !pendingCatSelected) return;
  const overrides = store.getOverrides();
  overrides[pendingCatTxId] = pendingCatSelected;
  store.setOverrides(overrides);
  closeAllModals();
  renderScreen(currentScreen);
}

/* ============================================================
   CATEGORIAS
   ============================================================ */
function renderCategorias() {
  const txs = store.getTransactions().filter(t => catSegment === "gastos" ? t.type === "saida" : t.type === "entrada");
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
  const currentAno = anoSel.value || years[0] || "2026";
  anoSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  anoSel.value = currentAno;

  const mesSel = document.getElementById("rel-mes");
  mesSel.innerHTML = `<option value="all">Todos os meses</option>` + MONTH_NAMES.map((m,i) => `<option value="${i}">${m}</option>`).join("");

  const bancoSel = document.getElementById("rel-banco");
  const connected = store.getInstitutions().filter(i => i.connected);
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
  return store.getTransactions().filter(t => {
    if (ano && !t.date.startsWith(ano)) return false;
    if (mes !== "all" && parseInt(t.date.slice(5,7))-1 !== parseInt(mes)) return false;
    if (banco !== "all" && t.bank !== banco) return false;
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

  // bar chart: entradas vs saidas por mes (últimos 6 meses disponíveis dentro do filtro de ano)
  const ano = document.getElementById("rel-ano").value;
  const allTx = store.getTransactions().filter(t => t.date.startsWith(ano));
  const byMonth = {};
  for (let m=0; m<12; m++) byMonth[m] = { entrada:0, saida:0 };
  allTx.forEach(t => {
    const m = parseInt(t.date.slice(5,7))-1;
    if (t.type === "entrada") byMonth[m].entrada += t.value; else byMonth[m].saida += Math.abs(t.value);
  });
  drawBarChart("bar-chart", byMonth);

  // por banco
  const connected = store.getInstitutions().filter(i => i.connected);
  const el = document.getElementById("rel-por-banco");
  el.innerHTML = connected.map(i => {
    const val = txs.filter(t => t.bank === i.id && t.type === "saida").reduce((s,t) => s + Math.abs(t.value), 0);
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
  const padding = 24, chartH = h - padding - 20;
  const groupW = (w - padding) / 12;
  ctx.font = "600 9px Inter, sans-serif";
  ctx.fillStyle = "#6B7A90";
  ctx.textAlign = "center";
  months.forEach(m => {
    const x = padding + m*groupW;
    const barW = groupW/2 - 4;
    const eH = (byMonth[m].entrada/maxVal) * chartH;
    const sH = (byMonth[m].saida/maxVal) * chartH;
    ctx.fillStyle = "#16A34A";
    ctx.fillRect(x+2, h-20-eH, barW, eH);
    ctx.fillStyle = "#E5484D";
    ctx.fillRect(x+2+barW+2, h-20-sH, barW, sH);
    ctx.fillStyle = "#6B7A90";
    ctx.fillText(MONTH_NAMES[m].slice(0,3), x+groupW/2, h-6);
  });
}

function renderComparacao() {
  const m1 = document.getElementById("comp-mes1").value;
  const m2 = document.getElementById("comp-mes2").value;
  const tipo = document.getElementById("comp-tipo").value;
  const txs = store.getTransactions();
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
function loginUser(user) {
  store.setUser(user);
  document.getElementById("greeting-text").textContent = `Olá, ${user.name.split(" ")[0]}!`;
  updateAvatar(user);
  showApp();
}
function updateAvatar(user) {
  const img = document.getElementById("avatar-img");
  const icon = document.getElementById("avatar-icon");
  const perfilImg = document.getElementById("perfil-avatar");
  const perfilIcon = document.getElementById("perfil-avatar-icon");
  document.getElementById("perfil-nome").textContent = user.name;
  document.getElementById("perfil-email").textContent = user.email;
  if (user.picture) {
    img.src = user.picture; img.classList.remove("hidden"); icon.classList.add("hidden");
    perfilImg.src = user.picture; perfilImg.classList.remove("hidden"); perfilIcon.classList.add("hidden");
  } else {
    img.classList.add("hidden"); icon.classList.remove("hidden");
    perfilImg.classList.add("hidden"); perfilIcon.classList.remove("hidden");
  }
}
function logoutUser() {
  store.clearUser();
  closeAllModals();
  showLogin();
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(base64).split("").map(c =>
      "%" + ("00"+c.charCodeAt(0).toString(16)).slice(-2)).join("")));
  } catch (e) { return null; }
}

function handleGoogleCredential(response) {
  const payload = decodeJwtPayload(response.credential);
  if (!payload) return;
  loginUser({ name: payload.name || "Usuário Google", email: payload.email || "", picture: payload.picture || "" });
}

function initGoogleLogin() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    // biblioteca ainda não carregou — tenta novamente em breve
    setTimeout(initGoogleLogin, 300);
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false
    });
    google.accounts.id.renderButton(document.getElementById("google-btn-container"), {
      theme: "outline", size: "large", width: 296, shape: "pill", text: "continue_with"
    });
  } catch (e) {
    console.warn("Não foi possível iniciar o Google Sign-In:", e);
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wire(fn, label) {
  try { fn(); } catch (err) { console.error(`FinanHub: falha ao configurar "${label}"`, err); }
}

document.addEventListener("DOMContentLoaded", () => {
  // Cada bloco roda isolado: se um botão/elemento falhar ao ser
  // configurado, os outros continuam funcionando normalmente.

  wire(() => {
    document.getElementById("btn-email-login").addEventListener("click", () => openModal("modal-email"));
    document.getElementById("link-create-account").addEventListener("click", (e) => { e.preventDefault(); openModal("modal-email"); });
    document.getElementById("btn-do-email-login").addEventListener("click", () => {
      const name = document.getElementById("input-name").value.trim() || "Usuário";
      const email = document.getElementById("input-email").value.trim() || "usuario@email.com";
      closeAllModals();
      loginUser({ name, email, picture: "" });
    });
  }, "login por e-mail");

  wire(() => {
    document.getElementById("btn-profile").addEventListener("click", () => openModal("modal-perfil"));
    document.getElementById("btn-logout").addEventListener("click", logoutUser);
  }, "perfil");

  wire(() => {
    document.getElementById("bottom-nav").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-btn");
      if (btn) navigateTo(btn.dataset.nav);
    });
    document.getElementById("content").addEventListener("click", (e) => {
      const navLink = e.target.closest("[data-nav]");
      if (navLink) { e.preventDefault(); navigateTo(navLink.dataset.nav); }
    });
  }, "navegação inferior");

  wire(() => {
    document.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeAllModals));
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAllModals(); });
    });
  }, "fechar modais");

  wire(() => {
    document.getElementById("filter-periodo").addEventListener("change", (e) => { dashFilterPeriodo = e.target.value; renderDashboard(); });
    document.getElementById("filter-banco").addEventListener("change", (e) => { dashFilterBanco = e.target.value; renderDashboard(); });
    document.getElementById("btn-demo-data").addEventListener("click", () => {
      generateDemoData();
      dashFilterPeriodo = "all"; dashFilterBanco = "all";
      renderScreen(currentScreen);
    });
  }, "filtros do dashboard");

  wire(() => {
    document.getElementById("btn-add-inst").addEventListener("click", openAddInstModal);
    document.body.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-toggle-bank]");
      if (toggleBtn) {
        toggleBankConnection(toggleBtn.dataset.toggleBank);
        if (document.getElementById("modal-add-inst").classList.contains("active")) openAddInstModal();
      }
    });
  }, "bancos");

  wire(() => {
    document.getElementById("search-transacoes").addEventListener("input", (e) => { txSearch = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-banco").addEventListener("change", (e) => { txFilterBanco = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
    document.getElementById("tx-filter-tipo").addEventListener("change", (e) => { txFilterTipo = e.target.value; txVisibleCount = TX_PAGE_SIZE; renderTransacoes(); });
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

  // boot — roda por último e nunca depende do Google, para garantir
  // que o app abre mesmo se o login do Google falhar
  wire(() => {
    const user = store.getUser();
    if (user) {
      document.getElementById("greeting-text").textContent = `Olá, ${user.name.split(" ")[0]}!`;
      updateAvatar(user);
      if (!store.getTransactions().length) generateDemoData();
      showApp();
    } else {
      showLogin();
    }
  }, "boot");

  // Google Sign-In é o último a ser configurado e nunca bloqueia o
  // restante do app caso o domínio não esteja autorizado no Google
  // Cloud Console (erro "origin_mismatch").
  wire(initGoogleLogin, "Google Sign-In");
});
