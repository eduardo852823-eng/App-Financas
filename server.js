/* ============================================================
   FinanApp — backend
   Node.js + Express + Turso (libSQL)
   Guarda: usuários (login por e-mail ou Google), preferências
   (tema, etc.), instituições conectadas, transações e itens
   conectados via Pluggy (Open Finance).
   ============================================================ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@libsql/client");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET || "troque_essa_chave_em_producao";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "732987980412-3caubvvgvknj05hpl5mb5p2lcfs3b3pm.apps.googleusercontent.com";
const PORT = process.env.PORT || 3001;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express();
app.use(cors());
app.use(express.json());

/* ============================================================
   BANCO DE DADOS (Turso / libSQL)
   ============================================================ */
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("Faltam TURSO_DATABASE_URL e/ou TURSO_AUTH_TOKEN no .env");
  process.exit(1);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helpers para deixar as queries parecidas com o estilo anterior (better-sqlite3)
async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}
async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function run(sql, args = []) {
  const r = await db.execute({ sql, args });
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
}

async function initDb() {
  await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_id TEXT,
  avatar TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  theme TEXT DEFAULT 'light',
  currency TEXT DEFAULT 'BRL'
);

CREATE TABLE IF NOT EXISTS institutions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank_id TEXT NOT NULL,
  connected INTEGER DEFAULT 0,
  last_sync TEXT,
  PRIMARY KEY (user_id, bank_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  desc TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  value REAL NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_rules (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS merchant_cache (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS pluggy_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cpf TEXT NOT NULL,
  item_id TEXT NOT NULL UNIQUE,
  institution_name TEXT,
  status TEXT DEFAULT 'UPDATED',
  created_at TEXT DEFAULT (datetime('now')),
  last_sync TEXT
);

CREATE TABLE IF NOT EXISTS custom_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_overrides (
  user_id INTEGER NOT NULL REFERENCES users(id),
  cat_id TEXT NOT NULL,
  name TEXT,
  icon TEXT,
  color TEXT,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, cat_id)
);

CREATE TABLE IF NOT EXISTS pluggy_accounts (
  account_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  name TEXT,
  type TEXT,
  balance REAL,
  updated_at TEXT,
  data TEXT,
  bills TEXT
);

CREATE TABLE IF NOT EXISTS pluggy_investments (
  investment_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  name TEXT,
  type TEXT,
  subtype TEXT,
  institution TEXT,
  balance REAL,
  amount_invested REAL,
  monthly_rate REAL,
  rate_source TEXT,
  annual_rate REAL,
  due_date TEXT,
  updated_at TEXT,
  data TEXT
);
`);
  // colunas novas em transactions (ignora o erro se já existirem)
  for (const col of ["external_id TEXT", "account_id TEXT", "account_name TEXT", "account_type TEXT"]) {
    try { await db.execute(`ALTER TABLE transactions ADD COLUMN ${col}`); } catch (e) { /* já existe */ }
  }
  // colunas novas: categoria escolhida manualmente (a IA nunca sobrescreve), categoria original do Pluggy e último acesso do usuário
  for (const stmt of [
    "ALTER TABLE transactions ADD COLUMN category_manual INTEGER DEFAULT 0",
    "ALTER TABLE transactions ADD COLUMN pluggy_category TEXT",
    "ALTER TABLE transactions ADD COLUMN category_source TEXT",
    "ALTER TABLE users ADD COLUMN last_seen_at TEXT",
  ]) {
    try { await db.execute(stmt); } catch (e) { /* já existe */ }
  }
  // colunas novas em pluggy_accounts (dados completos da conta e faturas do cartão)
  for (const col of ["data TEXT", "bills TEXT"]) {
    try { await db.execute(`ALTER TABLE pluggy_accounts ADD COLUMN ${col}`); } catch (e) { /* já existe */ }
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_tx_external ON transactions(user_id, external_id)");
}

/* ============================================================
   DADOS ESTÁTICOS (categorias, regras)
   ============================================================ */
// IDs dos bancos fictícios antigos (usados só para limpar dados de exemplo que ficaram salvos)
const DEMO_BANK_IDS = ["inter", "bb", "caixa", "nubank", "itau", "bradesco", "santander", "brb", "c6", "btg", "mp", "sicoob", "sicredi"];

/* ============================================================
   CATEGORIZADOR AUTOMÁTICO ("IA" das transações)

   Ordem de decisão (a primeira que acertar vence):
   1. Regras aprendidas do usuário (quando ele corrige uma categoria)
   2. Palavras-chave de estabelecimentos/serviços brasileiros
   3. Casamento aproximado (nome truncado pelo banco / erro de digitação)
   4. Categoria que o próprio Pluggy/banco mandou junto da transação
   5. Modelo estatístico treinado com o histórico DO PRÓPRIO usuário
   6. Claude (opcional, só se ANTHROPIC_API_KEY estiver configurada)
   7. "nao_identificada"

   Match de palavras-chave: texto e palavras normalizados (sem acento, minúsculo,
   sem símbolos). Palavra com 5+ letras casa pelo INÍCIO de qualquer palavra do
   texto; até 4 letras (ou terminada em "$") só casa a palavra inteira.
   ============================================================ */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Regras de "exceção": vencem todas as outras (ex.: "amazon prime" é streaming, não compra)
const PRE_RULES = [
  { cat: "entretenimento", kws: ["amazon prime", "prime video", "primevideo", "amazon music", "amazon kindle"] },
  { cat: "alimentacao", kws: ["uber eats", "ubereats", "99 food", "99food", "rappi", "ifood"] },
  { cat: "compras", kws: ["mercado livre", "mercadolivre", "mercado pago", "mercadopago"] },
  { cat: "fatura", kws: ["pagamento de fatura", "pagamento fatura", "pag fatura", "pgto fatura", "fatura cartao", "fatura paga", "pagamento recebido"] },
];

// Ordem importa: do mais específico para o mais genérico
const RULES = [
  { cat: "alimentacao", kws: [
    "restaurante", "lanchonete", "lanche", "pizza", "hamburgueria", "hamburguer", "churrascaria", "churrasco", "padaria", "panificadora",
    "confeitaria", "sorveteria", "acaiteria", "acai", "cafeteria", "cafe", "bar", "boteco", "choperia", "cervejaria", "adega", "pastelaria",
    "pastel", "sushi", "japones", "marmita", "marmitaria", "self service", "rotisseria", "doceria", "chocolate", "bomboniere",
    "mcdonalds", "mc donalds", "burger king", "bk brasil", "subway", "outback", "habibs", "giraffas", "spoleto", "starbucks", "madero",
    "coco bambu", "bobs", "dominos", "pizza hut", "kfc", "china in box", "cacau show", "kopenhagen", "ragazzo", "vivenda do camarao",
    "supermercado", "hipermercado", "mercado", "mercadinho", "mercearia", "hortifruti", "sacolao", "acougue", "emporio", "quitanda",
    "atacadao", "assai", "atacarejo", "carrefour", "pao de acucar", "walmart", "sams club", "makro", "comper", "bretas", "supernosso",
    "guanabara", "zaffari", "tatico", "atakarejo", "condor", "angeloni", "prezunic", "super adega", "oba hortifruti", "dom atacadista",
    "epa", "savegnago", "cooper", "giassi", "fort atacadista", "verdemar", "extrabom", "hirota", "st marche", "mambo", "sonda",
  ] },
  { cat: "transporte", kws: [
    "uber", "99", "99app", "99pop", "99 pop", "99 taxi", "cabify", "indriver", "taxi", "moto taxi", "mototaxi",
    "posto", "shell", "ipiranga", "petrobras", "texaco", "combustivel", "gasolina", "etanol", "diesel", "gnv", "abastecimento",
    "estacionamento", "parquimetro", "zona azul", "estapar", "sem parar", "semparar", "conectcar", "veloe", "pedagio", "autopass",
    "metro$", "cptm", "bilhete unico", "sptrans", "riocard", "dftrans", "onibus", "brt", "trem",
    "detran", "lava jato", "lava rapido", "oficina", "mecanica", "autopecas", "auto pecas", "pneu", "borracharia", "funilaria",
    "patinete", "tembici", "bike itau",
  ] },
  { cat: "entretenimento", kws: [
    "netflix", "spotify", "disney", "hbo", "hbo max", "youtube", "globoplay", "deezer", "crunchyroll", "paramount", "telecine",
    "apple tv", "apple music", "twitch", "steam", "steampowered", "playstation", "psn", "xbox", "nintendo", "epic games", "riot games", "blizzard",
    "cinema", "cinemark", "kinoplex", "uci", "ingresso", "sympla", "eventim", "ticketmaster", "teatro", "parque", "boliche", "karaoke",
    "tinder", "bumble", "clube", "balada", "show",
  ] },
  { cat: "saude", kws: [
    "farmacia", "farmacias", "drogaria", "drogasil", "droga raia", "drogaraia", "raia", "pacheco", "pague menos", "paguemenos", "ultrafarma", "panvel",
    "hospital", "clinica", "laboratorio", "exame", "consulta", "dentista", "odonto", "medico", "fisioterapia", "nutricionista", "psicolog",
    "otica", "unimed", "amil", "sulamerica", "hapvida", "notredame", "plano de saude", "saude",
    "academia", "smart fit", "smartfit", "bluefit", "bodytech", "selfit", "gympass", "wellhub", "totalpass", "crossfit",
  ] },
  { cat: "educacao", kws: [
    "escola", "colegio", "curso", "faculdade", "universidade", "udemy", "alura", "coursera", "duolingo", "mensalidade escolar",
    "matricula", "kumon", "cultura inglesa", "ccaa", "wizard", "fisk", "yazigi", "descomplica", "estacio", "unip", "uniceub", "papelaria",
  ] },
  { cat: "viagens", kws: [
    "airbnb", "booking", "decolar", "latam", "gol linhas", "azul linhas", "voegol", "voeazul", "cvc", "hurb", "123milhas", "maxmilhas",
    "hotel", "pousada", "hostel", "resort", "rodoviaria", "clickbus", "buser", "localiza", "movida", "unidas", "expedia", "trivago", "passagem", "aeroporto",
  ] },
  { cat: "outros", kws: ["petz", "cobasi", "petlove", "petshop", "pet shop", "veterinari"] },
  { cat: "compras", kws: [
    "amazon", "amzn", "shopee", "magazine luiza", "magalu", "americanas", "submarino", "shein", "aliexpress", "alibaba", "temu",
    "casas bahia", "ponto frio", "fast shop", "kabum", "pichau", "terabyte", "leroy merlin", "telhanorte", "tok stok", "tokstok", "ikea", "havan$",
    "renner", "riachuelo", "zara", "hering", "centauro", "decathlon", "netshoes", "dafiti", "zattini", "nike", "adidas", "arezzo",
    "sephora", "boticario", "natura$", "avon", "kalunga", "livraria", "saraiva", "pernambucanas", "vestuario", "calcados", "perfumaria", "eletronicos",
  ] },
  { cat: "contas", kws: [
    "luz", "energia", "enel", "cemig", "cpfl", "neoenergia", "equatorial", "celpe", "coelba", "energisa", "light servicos",
    "agua", "esgoto", "caesb", "sabesp", "copasa", "sanepar", "cedae", "embasa", "compesa", "saneago",
    "gas", "comgas", "naturgy", "ultragaz", "liquigas", "supergasbras",
    "internet", "vivo", "claro", "claro net", "oi fibra", "oi movel", "tim s a", "tim celular", "tim brasil", "brisanet", "algar", "telefone", "celular", "fibra", "telefonica",
    "condominio", "aluguel", "imobiliaria", "seguro", "porto seguro",
  ] },
  { cat: "taxas", kws: [
    "tarifa", "iof$", "anuidade", "juros", "encargos", "multa", "imposto", "iptu", "ipva", "darf$", "das$", "gru$", "receita federal",
    "inss$", "cartorio", "custas", "taxa$", "taxas",
  ] },
  { cat: "investimentos", kws: [
    "aplicacao", "resgate", "cdb", "lci", "lca", "tesouro", "rendimento", "dividendo", "renda fixa", "renda variavel", "fundo de investimento",
    "xp investimentos", "nuinvest", "clear corretora", "rico investimentos", "binance", "mercado bitcoin", "cofrinho", "caixinha", "porquinho",
    "poupanca", "b3$", "fii$",
  ] },
  { cat: "salario", kws: [
    "salario", "folha de pagamento", "folha pagamento", "proventos", "decimo terceiro", "13o salario", "ferias",
  ] },
  // genéricos: só entram se nada mais específico casou
  { cat: "compras", kws: ["loja", "lojas", "magazine", "shopping", "store", "outlet"] },
  { cat: "transferencias", kws: ["pix", "ted$", "doc$", "transferencia", "transf", "transferido"] },
];

/* ---------- compilação das palavras-chave ---------- */
function compile(groups) {
  return groups.map(g => ({
    cat: g.cat,
    tests: g.kws.map(raw => {
      const exact = raw.endsWith("$");
      const kw = normalize(exact ? raw.slice(0, -1) : raw);
      const prefixOk = !exact && kw.length >= 5;
      return { kw, needle: prefixOk ? " " + kw : " " + kw + " " };
    }),
  }));
}
const COMPILED_PRE = compile(PRE_RULES);
const COMPILED = compile(RULES);

function matchGroups(padded, groups) {
  for (const g of groups) {
    for (const t of g.tests) if (padded.includes(t.needle)) return g.cat;
  }
  return null;
}

/* ---------- categoria que o Pluggy já manda (fallback) ---------- */
function mapPluggyCategory(name) {
  const c = normalize(name);
  if (!c || c === "uncategorized" || c === "others" || c === "other") return null;
  const has = (...words) => words.some(w => c.includes(w));
  if (has("credit card payment", "card payment", "bill payment")) return "fatura";
  if (/\b(tax|taxes|fee|fees|iof|fine|fines|penalty|penalties)\b/.test(c) || has("interest charged")) return "taxas";
  if (has("invest", "fixed income", "variable income", "stock", "dividend", "savings", "retirement", "pension", "crypto")) return "investimentos";
  if (has("salary", "income", "payroll", "wage", "proceeds")) return "salario";
  if (has("food delivery", "eating out", "restaurant", "grocer", "supermarket", "bakery", "food and drink", "food", "bar ")) return "alimentacao";
  if (has("taxi", "ride", "transport", "fuel", "gas station", "parking", "toll", "vehicle", "car ", "automotive")) return "transporte";
  if (has("stream", "entertainment", "gaming", "game", "cinema", "leisure", "music", "video", "event")) return "entretenimento";
  if (has("health", "pharmac", "drugstore", "doctor", "dental", "hospital", "gym", "fitness", "wellness")) return "saude";
  if (has("education", "school", "universit", "course", "tuition")) return "educacao";
  if (has("travel", "airline", "aviation", "accom", "hotel", "lodging")) return "viagens";
  if (has("utilit", "electric", "water", "telecom", "internet", "mobile", "phone", "rent", "housing", "insurance", "gas")) return "contas";
  if (has("shopping", "clothing", "electronic", "retail", "store", "department", "online shopping")) return "compras";
  if (has("transfer", "pix")) return "transferencias";
  return null;
}

/* ---------- chave do estabelecimento (para aprender com as correções) ----------
   "Compra no débito: PADARIA DO ZE 1234 15/09"  ->  "padaria do ze"
   "Pix enviado: Maria da Silva"                 ->  "maria da silva"                  */
const NOISE_PHRASES = [
  "transferencia enviada pelo pix", "transferencia recebida pelo pix", "transferencia enviada", "transferencia recebida",
  "compra no debito", "compra no credito", "compra com cartao", "compra debito", "compra credito", "compra",
  "pix enviado", "pix recebido", "pix", "pagamento de", "pagamento", "pgto", "debito", "credito", "parcela", "ted", "doc",
];
function merchantKey(desc) {
  let s = " " + normalize(desc) + " ";
  for (const p of NOISE_PHRASES) s = s.split(" " + p + " ").join(" ");
  const tokens = s.split(" ").filter(t => t.length > 1 && !/\d/.test(t));
  const key = tokens.slice(0, 3).join(" ");
  return key.length >= 3 ? key : "";
}


/* ---------- é Pix/TED/transferência? (nome de pessoa: não adianta casar por semelhança) ---------- */
function isPersonalTransfer(desc) {
  return /\b(pix|ted|doc|transf\w*)\b/.test(normalize(desc));
}

/* ---------- casamento aproximado ----------
   pega "SUPERMERC SAO JOAO" (banco cortou o nome) e "RESTAURNTE" (erro de digitação) */
function lev1(a, b) { // true se a distância de edição é no máximo 1
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}
const FUZZY_WORDS = [];
for (const g of RULES) {
  for (const raw of g.kws) {
    const kw = normalize(raw.endsWith("$") ? raw.slice(0, -1) : raw);
    if (kw.length >= 6 && !kw.includes(" ")) FUZZY_WORDS.push({ cat: g.cat, kw });
  }
}
function fuzzyMatch(norm) {
  const tokens = norm.split(" ").filter(t => t.length >= 5 && !/\d/.test(t));
  if (!tokens.length) return null;
  for (const { cat, kw } of FUZZY_WORDS) {
    for (const t of tokens) {
      if (t.length < kw.length && kw.startsWith(t)) return cat;      // nome cortado
      if (t.length >= 7 && kw.length >= 7 && lev1(t, kw)) return cat; // 1 letra errada/faltando
    }
  }
  return null;
}

/* ---------- modelo estatístico (Naive Bayes) treinado com o histórico do usuário ----------
   Aprende quais palavras aparecem em cada categoria. Correções manuais pesam 3x.
   Só chuta quando tem muita certeza (>= 85%) e evidência suficiente.               */
const MODEL_STOP = new Set(["pix", "enviado", "recebido", "enviada", "recebida", "compra", "debito", "credito", "pagamento", "pgto", "transferencia",
  "transf", "ted", "doc", "ltda", "com", "cartao", "parcela", "www", "loja", "lojas", "filial", "matriz", "comercio", "servicos", "eireli", "the", "and"]);
function modelTokens(desc) {
  return [...new Set(normalize(desc).split(" ").filter(t => t.length >= 3 && !/\d/.test(t) && !MODEL_STOP.has(t)))];
}
function buildModel(rows) { // rows: [{ desc, category, manual }]
  const tokenCat = new Map(), catTotal = new Map();
  for (const r of rows) {
    if (!r.category || r.category === "nao_identificada") continue;
    const w = r.manual ? 3 : 1;
    for (const t of modelTokens(r.desc)) {
      let m = tokenCat.get(t);
      if (!m) { m = new Map(); tokenCat.set(t, m); }
      m.set(r.category, (m.get(r.category) || 0) + w);
      catTotal.set(r.category, (catTotal.get(r.category) || 0) + w);
    }
  }
  return { tokenCat, catTotal, V: tokenCat.size };
}
function predictModel(model, desc, minPosterior = 0.85) {
  if (!model || !model.V) return null;
  const toks = modelTokens(desc).filter(t => model.tokenCat.has(t));
  if (!toks.length) return null;
  const cats = [...model.catTotal.keys()];
  const logs = cats.map(c => {
    let l = 0;
    for (const t of toks) l += Math.log(((model.tokenCat.get(t).get(c) || 0) + 0.1) / (model.catTotal.get(c) + 0.1 * model.V));
    return l;
  });
  const mx = Math.max(...logs);
  const exps = logs.map(l => Math.exp(l - mx));
  const sum = exps.reduce((a, b) => a + b, 0);
  let bi = 0;
  exps.forEach((e, i) => { if (e > exps[bi]) bi = i; });
  const best = cats[bi];
  const support = toks.reduce((s, t) => s + (model.tokenCat.get(t).get(best) || 0), 0);
  return exps[bi] / sum >= minPosterior && support >= 2 ? best : null;
}

/* ---------- função principal ----------
   opts.pluggy  -> objeto original da transação no Pluggy (category, merchant, descriptionRaw…)
   opts.learned -> Map(chave -> categoria) com as correções do usuário
   opts.model   -> modelo do usuário (buildModel)
   opts.cache   -> Map(chave -> categoria) respondida pelo Claude
   Devolve { cat, source } — source: learned | rule | pluggy | model | llm | null           */
// Pix/TED/transferência recebido só vira "salário" se o valor for maior que isso (ajustável por env var).
const SALARY_MIN_VALUE = Number(process.env.SALARY_MIN_VALUE) || 1000;

function categorizeFull(desc, opts = {}) {
  const { pluggy, learned, model, cache, value } = opts;
  if (learned && learned.size) {
    const c = learned.get(merchantKey(desc));
    if (c) return { cat: c, source: "learned" };
  }
  const extra = pluggy ? [pluggy.descriptionRaw, pluggy.merchant && pluggy.merchant.name, pluggy.merchant && pluggy.merchant.businessName] : [];
  const norm = normalize([desc, ...extra].filter(Boolean).join(" "));
  const padded = " " + norm + " ";

  const hit = matchGroups(padded, COMPILED_PRE) || matchGroups(padded, COMPILED);
  if (hit) return { cat: hit, source: "rule" };

  const personal = isPersonalTransfer(desc);
  if (!personal) {
    const f = fuzzyMatch(norm);
    if (f) return { cat: f, source: "rule" };
  }
  if (pluggy) {
    const p = mapPluggyCategory(pluggy.category);
    if (p) {
      // Pix/TED/DOC recebido: só é "salário" se o valor for alto; senão é sempre "transferências"
      // (evita que qualquer Pix marcado pelo Pluggy como "income"/"proceeds" vire salário por engano).
      if (personal) {
        if (p === "salario" && typeof value === "number" && value >= SALARY_MIN_VALUE) return { cat: "salario", source: "pluggy" };
        return { cat: "transferencias", source: "rule" };
      }
      return { cat: p, source: "pluggy" };
    }
  }
  if (!personal) {
    const m = predictModel(model, desc);
    if (m) return { cat: m, source: "model" };
  }
  if (cache && !personal) {
    const c = cache.get(merchantKey(desc));
    if (c && c !== "nao_identificada") return { cat: c, source: "llm" };
  }
  if (personal) return { cat: "transferencias", source: "rule" };
  return { cat: "nao_identificada", source: null };
}
function categorize(desc, opts) { return categorizeFull(desc, opts).cat; }

/* ---------- contexto do usuário: regras aprendidas + modelo treinado no histórico dele ---------- */
async function loadLearnedRules(userId) {
  const rows = await all("SELECT key, category FROM category_rules WHERE user_id = ?", [userId]);
  return new Map(rows.map(r => [r.key, r.category]));
}
async function buildUserCtx(userId) {
  const learned = await loadLearnedRules(userId);
  // treina só com o que é confiável: correções manuais e regras (nunca com chutes anteriores da própria IA)
  const rows = await all(
    `SELECT "desc" AS d, category, COALESCE(category_manual, 0) AS manual FROM transactions
     WHERE user_id = ? AND category <> 'nao_identificada' AND COALESCE(category_source, '') NOT IN ('model', 'llm')`,
    [userId]
  );
  const model = buildModel(rows.map(r => ({ desc: r.d, category: r.category, manual: Number(r.manual) === 1 })));
  return { learned, model };
}
function classify(desc, ctx, pluggy, value) {
  return categorizeFull(desc, { pluggy, learned: ctx.learned, model: ctx.model, cache: merchantCache, value });
}

// Roda a categorização de novo nas transações ainda "não identificadas" (nunca mexe no que o usuário escolheu à mão).
// userId opcional: sem ele, processa todos os usuários (usado no boot).
async function recategorizeUnidentified(userId = null) {
  const rows = userId == null
    ? await all(`SELECT id, user_id, "desc" AS d FROM transactions WHERE category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0`)
    : await all(`SELECT id, user_id, "desc" AS d FROM transactions WHERE user_id = ? AND category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0`, [userId]);
  if (!rows.length) return 0;
  const ctxByUser = new Map();
  const updates = [];
  for (const r of rows) {
    if (!ctxByUser.has(r.user_id)) ctxByUser.set(r.user_id, await buildUserCtx(r.user_id));
    const { cat, source } = classify(r.d, ctxByUser.get(r.user_id));
    if (cat !== "nao_identificada") updates.push({ sql: "UPDATE transactions SET category = ?, category_source = ? WHERE id = ?", args: [cat, source, r.id] });
  }
  for (let i = 0; i < updates.length; i += 200) await db.batch(updates.slice(i, i + 200), "write");
  return updates.length;
}

/* ---------- IA como último recurso (OPCIONAL) ----------
   Usa o Gemini (Google) se GEMINI_API_KEY existir; senão cai para o Claude se ANTHROPIC_API_KEY existir;
   se nenhuma das duas estiver configurada, essa etapa simplesmente não faz nada.
   Manda apenas o NOME do estabelecimento (minúsculo, sem números, sem valor, sem dados do usuário) e
   NUNCA Pix/TED/transferências (essas nunca passam por IA — a regra de salário/transferência é sempre
   decidida por código, olhando o valor). A resposta fica em cache (merchant_cache): cada estabelecimento
   é perguntado uma única vez, não importa qual IA respondeu. */
const LLM_CATEGORIES = ["alimentacao", "transporte", "contas", "entretenimento", "compras", "saude", "educacao", "viagens",
  "transferencias", "fatura", "investimentos", "taxas", "outros", "salario", "nao_identificada"];
const LLM_SYSTEM_PROMPT =
  "Você classifica nomes de estabelecimentos de extratos bancários brasileiros (já em minúsculas e sem números) em categorias de gastos pessoais. " +
  "Categorias válidas: alimentacao (restaurantes, mercados, delivery), transporte (apps de corrida, combustível, estacionamento, pedágio, oficina), " +
  "contas (luz, água, gás, internet, telefone, aluguel, condomínio, seguros), entretenimento (streaming, jogos, cinema, shows), " +
  "compras (lojas, e-commerce, roupas, eletrônicos, casa), saude (farmácia, médico, plano, academia), educacao, viagens (hotel, passagem, aluguel de carro), " +
  "transferencias, fatura (pagamento de cartão), investimentos, taxas (tarifas, impostos, juros), outros, " +
  "nao_identificada (use quando não der para ter uma certeza razoável). " +
  "Você nunca recebe nomes de Pix, TED, DOC ou transferências — se algum vier mesmo assim, responda \"transferencias\", nunca \"salario\". " +
  'Responda SOMENTE com um objeto JSON {"nome recebido":"categoria"} contendo TODOS os nomes recebidos, sem texto extra.';

let merchantCache = new Map();
let llmRunning = false;
async function loadMerchantCache() {
  const rows = await all("SELECT key, category FROM merchant_cache");
  merchantCache = new Map(rows.map(r => [r.key, r.category]));
}

// Chama o Gemini (Google AI) e devolve { "nome recebido": "categoria" } ou lança erro.
async function askGemini(keys, apiKey) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(keys) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
  if (!text) throw new Error("Gemini não devolveu texto (resposta pode ter sido bloqueada)");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// Chama o Claude (Anthropic) e devolve { "nome recebido": "categoria" } ou lança erro.
async function askClaude(keys, apiKey) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: process.env.CATEGORY_LLM_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: LLM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(keys) }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = ((data.content || []).find(b => b.type === "text") || {}).text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function classifyPendingWithAI(limit = 40) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if ((!geminiKey && !claudeKey) || llmRunning) return 0;
  llmRunning = true;
  try {
    const rows = await all(`SELECT id, "desc" AS d FROM transactions WHERE category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0`);
    const keys = [];
    for (const r of rows) {
      if (isPersonalTransfer(r.d)) continue; // Pix/TED/transferências nunca vão pra IA
      const k = merchantKey(r.d);
      if (k && !merchantCache.has(k) && !keys.includes(k)) keys.push(k);
      if (keys.length >= limit) break;
    }
    if (keys.length) {
      let parsed = null, usedProvider = null, lastErr = null;
      if (geminiKey) {
        try { parsed = await askGemini(keys, geminiKey); usedProvider = "gemini"; }
        catch (e) { lastErr = e; console.error("[categorias] Gemini falhou, tentando o Claude se disponível:", e.message); }
      }
      if (!parsed && claudeKey) {
        try { parsed = await askClaude(keys, claudeKey); usedProvider = "claude"; }
        catch (e) { lastErr = e; console.error("[categorias] Claude também falhou:", e.message); }
      }
      if (!parsed) throw lastErr || new Error("Nenhum provedor de IA disponível respondeu");
      const stmts = [];
      for (const k of keys) {
        const c = LLM_CATEGORIES.includes(parsed[k]) ? parsed[k] : "nao_identificada";
        merchantCache.set(k, c);
        stmts.push({ sql: "INSERT OR REPLACE INTO merchant_cache (key, category, updated_at) VALUES (?,?,datetime('now'))", args: [k, c] });
      }
      await db.batch(stmts, "write");
      console.log(`[categorias] ${usedProvider} classificou ${keys.length} estabelecimentos novos`);
    }
    // aplica o que está no cache em tudo que ainda está sem categoria
    const updates = [];
    for (const r of rows) {
      if (isPersonalTransfer(r.d)) continue;
      const c = merchantCache.get(merchantKey(r.d));
      if (c && c !== "nao_identificada") {
        updates.push({ sql: "UPDATE transactions SET category = ?, category_source = 'llm' WHERE id = ? AND category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0", args: [c, r.id] });
      }
    }
    for (let i = 0; i < updates.length; i += 200) await db.batch(updates.slice(i, i + 200), "write");
    if (updates.length) console.log(`[categorias] ${updates.length} transações classificadas pela IA`);
    return updates.length;
  } catch (e) {
    console.error("[categorias] falha ao consultar a IA (segue sem):", e.message);
    return 0;
  } finally {
    llmRunning = false;
  }
}
function roundVal(v) { return Math.round(v * 100) / 100; }

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido" });
  }
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, avatar: u.avatar };
}
async function ensureDefaultsForUser(userId) {
  await run(`INSERT OR IGNORE INTO preferences (user_id) VALUES (?)`, [userId]);
}

/* Wrapper pra rotas async não precisarem de try/catch repetido */
const h = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: "Erro interno" });
});

/* ---------- registro por e-mail ---------- */
app.post("/api/auth/register", h(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Preencha nome, e-mail e senha" });
  const exists = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (exists) return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
  const hash = bcrypt.hashSync(password, 10);
  const info = await run("INSERT INTO users (name, email, password_hash) VALUES (?,?,?)", [name, email, hash]);
  await ensureDefaultsForUser(info.lastInsertRowid);
  const user = await get("SELECT * FROM users WHERE id = ?", [info.lastInsertRowid]);
  res.json({ token: makeToken(user), user: publicUser(user) });
}));

/* ---------- login por e-mail ---------- */
app.post("/api/auth/login", h(async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "E-mail ou senha incorretos" });
  }
  res.json({ token: makeToken(user), user: publicUser(user) });
}));

/* ---------- login com Google ---------- */
app.post("/api/auth/google", h(async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Credencial do Google ausente" });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    let user = await get("SELECT * FROM users WHERE email = ?", [payload.email]);
    if (!user) {
      const info = await run(
        "INSERT INTO users (name, email, google_id, avatar) VALUES (?,?,?,?)",
        [payload.name || "Usuário Google", payload.email, payload.sub, payload.picture || null]
      );
      await ensureDefaultsForUser(info.lastInsertRowid);
      user = await get("SELECT * FROM users WHERE id = ?", [info.lastInsertRowid]);
    } else if (!user.google_id) {
      await run("UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?", [payload.sub, payload.picture || null, user.id]);
      user = await get("SELECT * FROM users WHERE id = ?", [user.id]);
    }
    res.json({ token: makeToken(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: "Não foi possível validar o login do Google" });
  }
}));

/* ============================================================
   PERFIL / PREFERÊNCIAS
   ============================================================ */
app.get("/api/me", auth, h(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.userId]);
  const prefs = await get("SELECT * FROM preferences WHERE user_id = ?", [req.userId]);
  res.json({ user: publicUser(user), preferences: prefs || { theme: "light", currency: "BRL" } });
}));
app.put("/api/me/preferences", auth, h(async (req, res) => {
  const { theme, currency } = req.body;
  await run(
    `INSERT INTO preferences (user_id, theme, currency) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, currency = excluded.currency`,
    [req.userId, theme || "light", currency || "BRL"]
  );
  res.json({ ok: true });
}));

// Chamada uma vez ao abrir o app: devolve a data do acesso ANTERIOR (para o aviso de "vamos revisar as categorias?")
// e já grava o acesso de agora.
app.post("/api/me/visit", auth, h(async (req, res) => {
  const u = await get("SELECT last_seen_at FROM users WHERE id = ?", [req.userId]);
  await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [new Date().toISOString(), req.userId]);
  res.json({ previous: (u && u.last_seen_at) || null });
}));

/* ============================================================
   CATEGORIAS PERSONALIZADAS
   ============================================================ */
const CUSTOM_CAT_COLORS = ["#F59E0B","#3B82F6","#6366F1","#A855F7","#EC4899","#EF4444","#14B8A6","#0EA5E9","#10B981","#B45309"];
// IDs que nunca podem ser apagados/renomeados (categoria "coringa" usada como destino
// quando outra categoria é excluída, e o estado especial "não identificada").
const PROTECTED_CAT_IDS = ["outros", "nao_identificada"];

app.get("/api/categories", auth, h(async (req, res) => {
  const rows = await all("SELECT * FROM custom_categories WHERE user_id = ? ORDER BY id ASC", [req.userId]);
  const overrideRows = await all("SELECT * FROM category_overrides WHERE user_id = ?", [req.userId]);
  const overrides = {};
  overrideRows.forEach(o => { overrides[o.cat_id] = { name: o.name, icon: o.icon, color: o.color, deleted: !!o.deleted }; });
  res.json({
    custom: rows.map(r => ({ id: `custom_${r.id}`, name: r.name, icon: r.icon, color: r.color })),
    overrides
  });
}));
app.post("/api/categories", auth, h(async (req, res) => {
  const name = (req.body.name || "").trim();
  const icon = (req.body.icon || "").trim();
  if (!name || !icon) return res.status(400).json({ error: "Nome e emoji são obrigatórios." });
  const countRow = await get("SELECT COUNT(*) as n FROM custom_categories WHERE user_id = ?", [req.userId]);
  const color = CUSTOM_CAT_COLORS[Number(countRow.n) % CUSTOM_CAT_COLORS.length];
  const r = await run("INSERT INTO custom_categories (user_id, name, icon, color) VALUES (?,?,?,?)", [req.userId, name, icon, color]);
  res.json({ id: `custom_${r.lastInsertRowid}`, name, icon, color });
}));
// Edita nome/emoji/cor de QUALQUER categoria — inclusive as padrão do sistema (via override
// salvo por usuário; a categoria original não é alterada para os outros usuários).
app.put("/api/categories/:id", auth, h(async (req, res) => {
  const id = String(req.params.id);
  const name = (req.body.name || "").trim();
  const icon = (req.body.icon || "").trim();
  const color = (req.body.color || "").trim();
  if (!name || !icon) return res.status(400).json({ error: "Nome e emoji são obrigatórios." });
  if (id.startsWith("custom_")) {
    const rawId = id.replace(/^custom_/, "");
    await run("UPDATE custom_categories SET name = ?, icon = ? WHERE id = ? AND user_id = ?", [name, icon, rawId, req.userId]);
    return res.json({ ok: true });
  }
  await run(
    `INSERT INTO category_overrides (user_id, cat_id, name, icon, color, deleted) VALUES (?,?,?,?,?,0)
     ON CONFLICT(user_id, cat_id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = COALESCE(excluded.color, category_overrides.color), deleted = 0`,
    [req.userId, id, name, icon, color || null]
  );
  res.json({ ok: true });
}));
// Exclui uma categoria — custom (apaga de vez) ou padrão do sistema (marca como excluída
// só para esse usuário). Em ambos os casos, as transações que usavam essa categoria
// passam para "Outros" em vez de sumir.
app.delete("/api/categories/:id", auth, h(async (req, res) => {
  const id = String(req.params.id);
  if (PROTECTED_CAT_IDS.includes(id)) return res.status(400).json({ error: "Essa categoria não pode ser excluída." });
  await run("UPDATE transactions SET category = 'outros' WHERE user_id = ? AND category = ?", [req.userId, id]);
  await run("DELETE FROM category_rules WHERE user_id = ? AND category = ?", [req.userId, id]);
  if (id.startsWith("custom_")) {
    const rawId = id.replace(/^custom_/, "");
    await run("DELETE FROM custom_categories WHERE id = ? AND user_id = ?", [rawId, req.userId]);
  } else {
    await run(
      `INSERT INTO category_overrides (user_id, cat_id, deleted) VALUES (?,?,1)
       ON CONFLICT(user_id, cat_id) DO UPDATE SET deleted = 1`,
      [req.userId, id]
    );
  }
  res.json({ ok: true });
}));

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
app.get("/api/transactions", auth, h(async (req, res) => {
  const rows = await all("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC", [req.userId]);
  res.json(rows);
}));

// Ao trocar a categoria de uma transação o app APRENDE: guarda a regra desse estabelecimento e já
// aplica nas outras transações parecidas (que não foram escolhidas à mão). Vale também para as próximas.
app.put("/api/transactions/:id/category", auth, h(async (req, res) => {
  const { category } = req.body;
  if (!category || typeof category !== "string") return res.status(400).json({ error: "Categoria inválida" });
  const tx = await get(`SELECT id, "desc" AS d FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId]);
  if (!tx) return res.status(404).json({ error: "Transação não encontrada" });
  await run("UPDATE transactions SET category = ?, category_manual = 1, category_source = 'manual' WHERE id = ? AND user_id = ?", [category, tx.id, req.userId]);

  let applied = 0;
  const key = merchantKey(tx.d);
  if (key) {
    if (category === "nao_identificada") {
      await run("DELETE FROM category_rules WHERE user_id = ? AND key = ?", [req.userId, key]);
    } else {
      await run(
        `INSERT INTO category_rules (user_id, key, category) VALUES (?,?,?)
         ON CONFLICT(user_id, key) DO UPDATE SET category = excluded.category`,
        [req.userId, key, category]
      );
      const rows = await all(
        `SELECT id, "desc" AS d FROM transactions WHERE user_id = ? AND COALESCE(category_manual, 0) = 0 AND id <> ? AND category <> ?`,
        [req.userId, tx.id, category]
      );
      const updates = rows.filter(r => merchantKey(r.d) === key)
        .map(r => ({ sql: "UPDATE transactions SET category = ?, category_source = 'learned' WHERE id = ? AND user_id = ?", args: [category, r.id, req.userId] }));
      for (let i = 0; i < updates.length; i += 200) await db.batch(updates.slice(i, i + 200), "write");
      applied = updates.length;
      // a correção também ensina o modelo: tenta de novo nas que ainda estão sem categoria (nomes parecidos, não idênticos)
      applied += await recategorizeUnidentified(req.userId);
    }
  }
  res.json({ ok: true, applied });
}));

app.delete("/api/transactions/:id", auth, h(async (req, res) => {
  const info = await run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  if (!info.changes) return res.status(404).json({ error: "Transação não encontrada" });
  res.json({ ok: true });
}));

/* ============================================================
   PLUGGY (Open Finance) — múltiplos CPFs por usuário
   ============================================================ */
const PLUGGY_CLIENT_ID = process.env.PLUGGY_CLIENT_ID;
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET;
const PLUGGY_BASE_URL = "https://api.pluggy.ai";

let pluggyApiKeyCache = { key: null, expiresAt: 0 };
async function getPluggyApiKey() {
  if (pluggyApiKeyCache.key && Date.now() < pluggyApiKeyCache.expiresAt) {
    return pluggyApiKeyCache.key;
  }
  const resp = await fetch(`${PLUGGY_BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }),
  });
  if (!resp.ok) throw new Error(`Falha ao autenticar no Pluggy: ${resp.status}`);
  const data = await resp.json();
  pluggyApiKeyCache = { key: data.apiKey, expiresAt: Date.now() + 100 * 60 * 1000 }; // ~100min
  return data.apiKey;
}

// Busca TODAS as transações de uma conta no endpoint novo (GET /v2/transactions, paginação por cursor).
// O endpoint antigo (GET /transactions) já responde HTTP 410.
async function fetchAllPluggyTransactions(accountId, headers) {
  const list = [];
  let url = `${PLUGGY_BASE_URL}/v2/transactions?accountId=${accountId}`;
  for (let page = 0; page < 50 && url; page++) {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    list.push(...(data.results || []));
    url = data.next ? `${PLUGGY_BASE_URL}/v2/transactions${data.next}` : null; // "next" já vem pronto, é só anexar
  }
  return list;
}

// Faturas de um cartão de crédito (GET /bills?accountId=). Nem toda instituição devolve;
// se der erro ou vier vazio, segue sem faturas em vez de quebrar a sincronização.
async function fetchPluggyBills(accountId, headers) {
  try {
    const resp = await fetch(`${PLUGGY_BASE_URL}/bills?accountId=${accountId}`, { headers });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch (e) {
    return [];
  }
}

// Investimentos de uma conexão (GET /investments?itemId=, paginado). Nem todo item tem investimentos
// (o MeuPluggy só traz se o usuário tiver investimentos nas instituições conectadas). Devolve null se a
// chamada falhar (aí a sincronização mantém o que já estava salvo) e [] se simplesmente não houver nada.
async function fetchPluggyInvestments(itemId, headers) {
  try {
    const list = [];
    let page = 1, totalPages = 1;
    do {
      const resp = await fetch(`${PLUGGY_BASE_URL}/investments?itemId=${itemId}&page=${page}&pageSize=500`, { headers });
      if (!resp.ok) return resp.status === 404 ? [] : null;
      const data = await resp.json();
      list.push(...(data.results || []));
      totalPages = data.totalPages || 1;
      page++;
    } while (page <= totalPages && page <= 20);
    return list;
  } catch (e) {
    return null;
  }
}

// Taxa mensal (%) de um investimento: usa a rentabilidade do último mês informada pelo Pluggy;
// se não vier, estima a partir da taxa anual / dos últimos 12 meses (juros compostos).
function investmentMonthlyRate(inv) {
  const n = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const last = n(inv.lastMonthRate);
  if (last !== null) return { rate: last, source: "last_month" };
  const monthlyFromYear = (yearPct) => (Math.pow(1 + yearPct / 100, 1 / 12) - 1) * 100;
  const y12 = n(inv.lastTwelveMonthsRate);
  if (y12 !== null) return { rate: monthlyFromYear(y12), source: "estimated" };
  const ann = n(inv.annualRate) ?? n(inv.fixedAnnualRate);
  if (ann !== null) return { rate: monthlyFromYear(ann), source: "estimated" };
  return { rate: null, source: null };
}

// Em cartão de crédito o Pluggy manda compra como valor positivo (aumenta a fatura)
// e pagamento/estorno como negativo; no app compra é saída, então inverte o sinal.
function pluggyValue(amount, accountType) {
  return accountType === "CREDIT" ? -amount : amount;
}

// Gera um connect_token para o widget do Pluggy abrir no frontend.
// itemId opcional: passa quando é uma reconexão/atualização de um item existente.
app.post("/api/pluggy/connect-token", auth, h(async (req, res) => {
  const apiKey = await getPluggyApiKey();
  const { itemId } = req.body || {};
  const body = { clientUserId: String(req.userId) };
  if (itemId) body.itemId = itemId;
  const resp = await fetch(`${PLUGGY_BASE_URL}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return res.status(502).json({ error: "Falha ao gerar connect token no Pluggy" });
  const data = await resp.json();
  res.json({ connectToken: data.accessToken });
}));

// Chamado pelo frontend depois que o widget do Pluggy retorna um item_id.
// Salva a conexão vinculada ao CPF informado (permite vários CPFs por usuário).
app.post("/api/pluggy/items", auth, h(async (req, res) => {
  const { itemId, cpf, institutionName } = req.body || {};
  if (!itemId || !cpf) return res.status(400).json({ error: "itemId e cpf são obrigatórios" });
  await run(
    `INSERT INTO pluggy_items (user_id, cpf, item_id, institution_name, last_sync)
     VALUES (?,?,?,?, datetime('now'))
     ON CONFLICT(item_id) DO UPDATE SET status = 'UPDATED', last_sync = datetime('now')`,
    [req.userId, cpf, itemId, institutionName || null]
  );
  // OBS: aqui existia uma "limpeza de duplicados" que apagava qualquer conexão antiga
  // com o mesmo CPF + mesmo nome de conector. Isso causava o bug de "banco some":
  // como o conector do MeuPluggy tem o MESMO nome (ex.: "MeuPluggy") mesmo ao conectar
  // bancos diferentes (Inter, depois Banco do Brasil), a conexão do banco anterior era
  // identificada como "duplicada" e apagada por engano. Foi removida — cada item_id novo
  // agora é sempre mantido como uma conexão própria.
  res.json({ ok: true });
}));

// Lista todas as conexões (todos os CPFs) do usuário logado.
app.get("/api/pluggy/items", auth, h(async (req, res) => {
  const rows = await all(
    "SELECT id, cpf, item_id, institution_name, status, last_sync, created_at FROM pluggy_items WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId]
  );
  res.json(rows);
}));

// Contas (banco / cartão) de todas as conexões do usuário, com o saldo real informado pelo Pluggy.
app.get("/api/pluggy/accounts", auth, h(async (req, res) => {
  const rows = await all("SELECT account_id, item_id, name, type, balance, updated_at, data, bills FROM pluggy_accounts WHERE user_id = ?", [req.userId]);
  const parse = (txt) => { try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; } };
  res.json(rows.map(r => ({ ...r, data: parse(r.data), bills: parse(r.bills) || [] })));
}));

// Investimentos (valor atual + taxa mensal) de todas as conexões do usuário.
app.get("/api/pluggy/investments", auth, h(async (req, res) => {
  const rows = await all(
    `SELECT i.investment_id, i.item_id, i.name, i.type, i.subtype, i.institution, i.balance, i.amount_invested,
            i.monthly_rate, i.rate_source, i.annual_rate, i.due_date, i.updated_at, p.institution_name AS connection_name
     FROM pluggy_investments i LEFT JOIN pluggy_items p ON p.item_id = i.item_id
     WHERE i.user_id = ? ORDER BY i.balance DESC`,
    [req.userId]
  );
  res.json(rows);
}));

// Desconecta um item (remove do nosso banco e deleta no Pluggy).
app.delete("/api/pluggy/items/:id", auth, h(async (req, res) => {
  const item = await get("SELECT * FROM pluggy_items WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  if (!item) return res.status(404).json({ error: "Conexão não encontrada" });
  try {
    const apiKey = await getPluggyApiKey();
    await fetch(`${PLUGGY_BASE_URL}/items/${item.item_id}`, {
      method: "DELETE",
      headers: { "X-API-KEY": apiKey },
    });
  } catch (e) {
    console.error("Erro ao deletar item no Pluggy (seguindo mesmo assim):", e.message);
  }
  await run("DELETE FROM transactions WHERE user_id = ? AND bank_id = ?", [req.userId, item.item_id]);
  await run("DELETE FROM pluggy_accounts WHERE item_id = ?", [item.item_id]);
  await run("DELETE FROM pluggy_investments WHERE item_id = ? AND user_id = ?", [item.item_id, req.userId]);
  await run("DELETE FROM pluggy_items WHERE id = ?", [item.id]);
  res.json({ ok: true });
}));

// Sincroniza um item do Pluggy: grava as contas (com saldo real) e as transações de cada conta.
async function syncPluggyItemData(item, headers) {
  const accResp = await fetch(`${PLUGGY_BASE_URL}/accounts?itemId=${item.item_id}`, { headers });
  if (!accResp.ok) throw new Error(`Falha ao buscar contas no Pluggy (HTTP ${accResp.status})`);
  const { results: accounts } = await accResp.json();

  const ctx = await buildUserCtx(item.user_id);
  // transações antigas ainda "não identificadas" desta conexão: se agora dá para classificar, atualiza
  const pendentes = new Set((await all(
    "SELECT external_id FROM transactions WHERE user_id = ? AND bank_id = ? AND category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0 AND external_id IS NOT NULL",
    [item.user_id, item.item_id]
  )).map(r => r.external_id));
  const updStatements = [];

  const contas = [];
  const txStatements = [];
  let allOk = true;
  let transacoesProcessadas = 0;
  for (const acc of accounts) {
    let pluggyTx;
    try {
      pluggyTx = await fetchAllPluggyTransactions(acc.id, headers);
    } catch (e) {
      allOk = false;
      contas.push({ nome: acc.name, tipo: acc.type, transacoes: 0, erro: e.message });
      continue;
    }
    contas.push({ nome: acc.name, tipo: acc.type, transacoes: pluggyTx.length });
    for (const t of pluggyTx) {
      const desc = t.description || "Transação";
      const value = pluggyValue(t.amount, acc.type);
      const date = (t.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const { cat, source } = classify(desc, ctx, t, value);
      if (pendentes.has(t.id) && cat !== "nao_identificada") {
        updStatements.push({
          sql: "UPDATE transactions SET category = ?, category_source = ?, pluggy_category = ? WHERE user_id = ? AND external_id = ? AND category = 'nao_identificada' AND COALESCE(category_manual, 0) = 0",
          args: [cat, source, t.category || null, item.user_id, t.id]
        });
      }
      txStatements.push({
        sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category, external_id, account_id, account_name, account_type, pluggy_category, category_source)
              SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
              WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE user_id = ? AND external_id = ?)`,
        args: [
          item.user_id, date, desc, item.item_id, value, value >= 0 ? "entrada" : "saida", cat,
          t.id, acc.id, acc.name || null, acc.type || null, t.category || null, source,
          item.user_id, t.id
        ]
      });
      transacoesProcessadas++;
    }
  }

  const billsByAccount = {};
  for (const acc of accounts) {
    if (acc.type === "CREDIT") billsByAccount[acc.id] = await fetchPluggyBills(acc.id, headers);
  }
  const investments = await fetchPluggyInvestments(item.item_id, headers);
  const statements = accounts.map(acc => ({
    sql: `INSERT INTO pluggy_accounts (account_id, user_id, item_id, name, type, balance, updated_at, data, bills)
          VALUES (?,?,?,?,?,?, datetime('now'), ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET user_id = excluded.user_id, item_id = excluded.item_id,
            name = excluded.name, type = excluded.type, balance = excluded.balance,
            updated_at = excluded.updated_at, data = excluded.data, bills = excluded.bills`,
    args: [
      acc.id, item.user_id, item.item_id, acc.name || null, acc.type || null,
      typeof acc.balance === "number" ? acc.balance : null,
      JSON.stringify(acc), billsByAccount[acc.id] ? JSON.stringify(billsByAccount[acc.id]) : null
    ]
  }));
  // Só uma vez: apaga as transações antigas dessa conexão que foram salvas antes de existir o vínculo com a conta
  if (allOk) {
    statements.push({ sql: "DELETE FROM transactions WHERE user_id = ? AND bank_id = ? AND external_id IS NULL", args: [item.user_id, item.item_id] });
  }
  // Investimentos: troca tudo desta conexão pelo que o Pluggy devolveu agora (se a busca falhou, mantém o que já tinha)
  if (investments) {
    statements.push({ sql: "DELETE FROM pluggy_investments WHERE item_id = ? AND user_id = ?", args: [item.item_id, item.user_id] });
    for (const inv of investments) {
      const { rate, source } = investmentMonthlyRate(inv);
      const balance = typeof inv.balance === "number" ? inv.balance
        : typeof inv.value === "number" ? inv.value
        : typeof inv.amount === "number" ? inv.amount : null;
      statements.push({
        sql: `INSERT OR REPLACE INTO pluggy_investments (investment_id, user_id, item_id, name, type, subtype, institution, balance, amount_invested, monthly_rate, rate_source, annual_rate, due_date, updated_at, data)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`,
        args: [
          inv.id, item.user_id, item.item_id, inv.name || null, inv.type || null, inv.subtype || null,
          (inv.institution && inv.institution.name) || inv.issuer || null,
          balance, typeof inv.amount === "number" ? inv.amount : null, rate, source,
          typeof inv.annualRate === "number" ? inv.annualRate : (typeof inv.fixedAnnualRate === "number" ? inv.fixedAnnualRate : null),
          inv.dueDate ? String(inv.dueDate).slice(0, 10) : null, JSON.stringify(inv)
        ]
      });
    }
  }
  statements.push(...updStatements); // antes do offset, para não contar como "novas"
  const offset = statements.length;
  statements.push(...txStatements);

  const results = await db.batch(statements, "write");
  const novas = results.slice(offset).reduce((sum, r) => sum + (r.rowsAffected || 0), 0);
  await run("UPDATE pluggy_items SET last_sync = datetime('now') WHERE id = ?", [item.id]);
  classifyPendingWithAI().catch(() => {}); // opcional; só age se GEMINI_API_KEY ou ANTHROPIC_API_KEY existir
  return { accounts, contas, transacoesProcessadas, novas };
}

// Sincroniza um item sob demanda (botão "Sincronizar").
// Devolve também um diagnóstico (status da conexão, contas e nº de transações por conta).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Logo depois que o item é criado no Pluggy, ele fica processando (status UPDATING) por
// alguns segundos antes de ter contas disponíveis. Se a gente chamar /accounts nesse meio
// tempo, volta vazio — e o app mostrava "Nenhuma conta carregada ainda" mesmo com a conexão
// certinha. Aqui a gente espera o item sair de UPDATING (ou tenta de novo algumas vezes,
// mesmo sem confirmação, já que às vezes as contas já existem antes do status mudar).
async function waitPluggyItemReady(itemId, headers, { attempts = 5, delayMs = 2500 } = {}) {
  let itemInfo = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${PLUGGY_BASE_URL}/items/${itemId}`, { headers });
      if (r.ok) itemInfo = await r.json();
    } catch (e) { /* segue tentando */ }
    if (itemInfo && itemInfo.status !== "UPDATING") break;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return itemInfo;
}

app.post("/api/pluggy/sync/:itemId", auth, h(async (req, res) => {
  const item = await get("SELECT * FROM pluggy_items WHERE item_id = ? AND user_id = ?", [req.params.itemId, req.userId]);
  if (!item) return res.status(404).json({ error: "Conexão não encontrada" });

  const apiKey = await getPluggyApiKey();
  const headers = { "X-API-KEY": apiKey };

  // espera a conexão terminar de processar no Pluggy antes de buscar as contas
  const itemInfo = await waitPluggyItemReady(item.item_id, headers);

  let result;
  try {
    result = await syncPluggyItemData(item, headers);
    // se ainda não veio nenhuma conta e o item ainda tá processando, tenta mais uma vez
    // depois de um respiro — cobre o caso raro de demorar mais que o normal
    if (!result.accounts.length && itemInfo && itemInfo.status === "UPDATING") {
      await sleep(3000);
      result = await syncPluggyItemData(item, headers);
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  res.json({
    ok: true,
    contasEncontradas: result.accounts.length,
    transacoesProcessadas: result.transacoesProcessadas,
    novas: result.novas,
    contas: result.contas,
    item: itemInfo ? {
      status: itemInfo.status,
      executionStatus: itemInfo.executionStatus,
      conector: itemInfo.connector?.name,
      erro: itemInfo.error?.message || null
    } : null
  });
}));

/* ============================================================
   SINCRONIZAÇÃO AUTOMÁTICA (a cada 5 minutos)
   Percorre todos os itens Pluggy salvos e sincroniza cada um.
   ============================================================ */
async function syncAllPluggyItems() {
  if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) return; // Pluggy ainda não configurado
  try {
    const items = await all("SELECT * FROM pluggy_items");
    for (const item of items) {
      try {
        const apiKey = await getPluggyApiKey();
        await syncPluggyItemData(item, { "X-API-KEY": apiKey });
      } catch (e) {
        console.error(`[pluggy-sync] erro no item ${item.item_id}:`, e.message);
      }
    }
    console.log("[pluggy-sync] sincronização periódica concluída —", new Date().toISOString());
  } catch (e) {
    console.error("[pluggy-sync] erro geral:", e.message);
  }
}
setInterval(syncAllPluggyItems, 5 * 60 * 1000);

/* ============================================================
   START
   ============================================================ */
// Apaga dados fictícios antigos (extratos e bancos de exemplo). Só mexe nos IDs de banco demo;
// transações vindas do Pluggy (bank_id = item_id) e manuais não são tocadas.
// Corrige, uma vez, os Pix/TED/DOC recebidos que já tinham sido salvos como "salário" por engano
// (Pluggy categorizava como "income" e o sistema antigo aceitava qualquer valor). Nunca mexe em
// categoria escolhida manualmente pelo usuário.
async function fixMisclassifiedSalaryTransfers() {
  const rows = await all(
    `SELECT id, "desc" AS d, value FROM transactions
     WHERE category = 'salario' AND COALESCE(category_manual, 0) = 0 AND COALESCE(category_source, '') <> 'learned'`
  );
  const updates = rows
    .filter(r => isPersonalTransfer(r.d) && !(typeof r.value === "number" && r.value >= SALARY_MIN_VALUE))
    .map(r => ({ sql: "UPDATE transactions SET category = 'transferencias', category_source = 'rule' WHERE id = ?", args: [r.id] }));
  if (!updates.length) return 0;
  for (let i = 0; i < updates.length; i += 200) await db.batch(updates.slice(i, i + 200), "write");
  return updates.length;
}

// Depois do primeiro deploy pode ser removida.
async function removeDemoData() {
  const ph = DEMO_BANK_IDS.map(() => "?").join(",");
  await run(`DELETE FROM transactions WHERE bank_id IN (${ph})`, DEMO_BANK_IDS);
  await run("DELETE FROM institutions");
}

initDb()
  .then(removeDemoData)
  .then(loadMerchantCache)
  .then(() => recategorizeUnidentified())
  .then((n) => { if (n) console.log(`[categorias] ${n} transações reclassificadas automaticamente`); })
  .then(() => fixMisclassifiedSalaryTransfers())
  .then((n) => { if (n) console.log(`[categorias] ${n} transferências que estavam marcadas como salário foram corrigidas`); })
  .then(() => { classifyPendingWithAI().catch(() => {}); })
  .then(() => {
    app.listen(PORT, () => console.log(`FinanApp backend rodando em http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("Erro ao inicializar o banco:", e);
    process.exit(1);
  });
