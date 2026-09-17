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
`);
}

/* ============================================================
   DADOS ESTÁTICOS (bancos, categorias, regras) — iguais ao front
   ============================================================ */
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
  for (const rule of CATEGORY_RULES) if (rule.match.some(k => d.includes(k))) return rule.cat;
  return "nao_identificada";
}
function roundVal(v) { return Math.round(v * 100) / 100; }

/* ============================================================
   GERADOR DE TRANSAÇÕES (modo demo)
   ============================================================ */
const OUT_DESCS = [
  ["IFOOD", "alimentacao"], ["UBER", "transporte"], ["STEAM", "entretenimento"],
  ["NETFLIX", "entretenimento"], ["POSTO SHELL", "transporte"], ["MERCADO EXTRA", "alimentacao"],
  ["FARMACIA SP", "saude"], ["AMAZON", "compras"], ["CONTA DE LUZ", "contas"],
  ["INTERNET FIBRA", "contas"], ["RESTAURANTE", "alimentacao"], ["SHOPEE", "compras"],
  ["CURSO ONLINE", "educacao"], ["ACADEMIA", "saude"]
];
const IN_DESCS = ["PIX recebido", "Salário", "Pagamento recebido"];

async function generateTransactionsForBank(userId, bankId, { months = 6, modoTeste = false } = {}) {
  const fatorTeste = modoTeste ? 0.1 : 1;
  const now = new Date();
  const statements = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = d.getFullYear(), month = d.getMonth();
    statements.push({
      sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category) VALUES (?,?,?,?,?,?,?)`,
      args: [userId, dateStr(year, month, 3), "Salário", bankId, roundVal((1800 + Math.random() * 1200) * fatorTeste), "entrada", "salario"]
    });
    const numTx = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numTx; i++) {
      const day = 1 + Math.floor(Math.random() * 27);
      if (Math.random() < 0.12) {
        const desc = IN_DESCS[Math.floor(Math.random() * IN_DESCS.length)];
        statements.push({
          sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category) VALUES (?,?,?,?,?,?,?)`,
          args: [userId, dateStr(year, month, day), desc, bankId, roundVal((50 + Math.random() * 300) * fatorTeste), "entrada", "salario"]
        });
      } else {
        const [desc, cat] = OUT_DESCS[Math.floor(Math.random() * OUT_DESCS.length)];
        statements.push({
          sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category) VALUES (?,?,?,?,?,?,?)`,
          args: [userId, dateStr(year, month, day), desc, bankId, -roundVal((15 + Math.random() * 220) * fatorTeste), "saida", cat]
        });
      }
    }
  }
  if (statements.length) await db.batch(statements, "write");
}
function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

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
async function ensureDefaultsForUser(userId, { comDados = true } = {}) {
  const connectedIds = comDados ? ["inter", "nubank"] : [];
  for (const i of ALL_INSTITUTIONS) {
    await run(
      `INSERT OR IGNORE INTO institutions (user_id, bank_id, connected) VALUES (?,?,?)`,
      [userId, i.id, connectedIds.includes(i.id) ? 1 : 0]
    );
  }
  await run(`INSERT OR IGNORE INTO preferences (user_id) VALUES (?)`, [userId]);
  if (comDados) {
    for (const bankId of connectedIds) {
      await generateTransactionsForBank(userId, bankId, { months: 8 });
    }
  }
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
  await ensureDefaultsForUser(info.lastInsertRowid, { comDados: true });
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
      await ensureDefaultsForUser(info.lastInsertRowid, { comDados: true });
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

/* ============================================================
   INSTITUIÇÕES (BANCOS — modo demo)
   ============================================================ */
app.get("/api/institutions", auth, h(async (req, res) => {
  const rows = await all("SELECT bank_id, connected, last_sync FROM institutions WHERE user_id = ?", [req.userId]);
  const map = Object.fromEntries(rows.map(r => [r.bank_id, r]));
  const result = ALL_INSTITUTIONS.map(i => ({
    ...i,
    connected: !!(map[i.id] && map[i.id].connected),
    last_sync: map[i.id] ? map[i.id].last_sync : null
  }));
  res.json(result);
}));

app.post("/api/institutions/:bankId/toggle", auth, h(async (req, res) => {
  const { bankId } = req.params;
  const { modoTeste } = req.body || {};
  if (!ALL_INSTITUTIONS.some(i => i.id === bankId)) return res.status(404).json({ error: "Banco não encontrado" });
  const row = await get("SELECT * FROM institutions WHERE user_id = ? AND bank_id = ?", [req.userId, bankId]);
  const newConnected = row ? !row.connected : true;
  await run(
    `INSERT INTO institutions (user_id, bank_id, connected, last_sync) VALUES (?,?,?,?)
     ON CONFLICT(user_id, bank_id) DO UPDATE SET connected = excluded.connected, last_sync = excluded.last_sync`,
    [req.userId, bankId, newConnected ? 1 : 0, newConnected ? new Date().toISOString() : row?.last_sync || null]
  );
  if (newConnected) {
    const hasTx = await get("SELECT 1 FROM transactions WHERE user_id = ? AND bank_id = ? LIMIT 1", [req.userId, bankId]);
    if (!hasTx) await generateTransactionsForBank(req.userId, bankId, { months: 6, modoTeste: !!modoTeste });
  }
  res.json({ connected: newConnected });
}));

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
app.get("/api/transactions", auth, h(async (req, res) => {
  const rows = await all("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC", [req.userId]);
  res.json(rows);
}));

app.put("/api/transactions/:id/category", auth, h(async (req, res) => {
  const { category } = req.body;
  const info = await run("UPDATE transactions SET category = ? WHERE id = ? AND user_id = ?", [category, req.params.id, req.userId]);
  if (!info.changes) return res.status(404).json({ error: "Transação não encontrada" });
  res.json({ ok: true });
}));

app.delete("/api/transactions/:id", auth, h(async (req, res) => {
  const info = await run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  if (!info.changes) return res.status(404).json({ error: "Transação não encontrada" });
  res.json({ ok: true });
}));

/* ---------- modo demonstração ---------- */
app.post("/api/demo", auth, h(async (req, res) => {
  const { modoTeste } = req.body || {};
  await run("DELETE FROM transactions WHERE user_id = ?", [req.userId]);
  const banks = ["inter", "nubank", "caixa", "bb"];
  for (const i of ALL_INSTITUTIONS) {
    await run(
      `INSERT INTO institutions (user_id, bank_id, connected) VALUES (?,?,?)
       ON CONFLICT(user_id, bank_id) DO UPDATE SET connected = excluded.connected`,
      [req.userId, i.id, banks.includes(i.id) ? 1 : 0]
    );
  }
  for (const bankId of banks) {
    await generateTransactionsForBank(req.userId, bankId, { months: 8, modoTeste: !!modoTeste });
  }
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
  await run("DELETE FROM pluggy_items WHERE id = ?", [item.id]);
  res.json({ ok: true });
}));

// Puxa contas + transações reais de um item do Pluggy e grava na tabela transactions.
app.post("/api/pluggy/sync/:itemId", auth, h(async (req, res) => {
  const item = await get("SELECT * FROM pluggy_items WHERE item_id = ? AND user_id = ?", [req.params.itemId, req.userId]);
  if (!item) return res.status(404).json({ error: "Conexão não encontrada" });

  const apiKey = await getPluggyApiKey();
  const accResp = await fetch(`${PLUGGY_BASE_URL}/accounts?itemId=${item.item_id}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!accResp.ok) return res.status(502).json({ error: "Falha ao buscar contas no Pluggy" });
  const { results: accounts } = await accResp.json();

  let novasTransacoes = 0;
  const statements = [];
  for (const acc of accounts) {
    const txResp = await fetch(`${PLUGGY_BASE_URL}/transactions?accountId=${acc.id}&pageSize=500`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!txResp.ok) continue;
    const { results: pluggyTx } = await txResp.json();
    for (const t of pluggyTx) {
      const desc = t.description || "Transação";
      statements.push({
        sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category)
              SELECT ?,?,?,?,?,?,?
              WHERE NOT EXISTS (
                SELECT 1 FROM transactions WHERE user_id = ? AND date = ? AND desc = ? AND value = ?
              )`,
        args: [
          req.userId, t.date?.slice(0, 10), desc, item.item_id, t.amount, t.amount >= 0 ? "entrada" : "saida", categorize(desc),
          req.userId, t.date?.slice(0, 10), desc, t.amount
        ]
      });
      novasTransacoes++;
    }
  }
  if (statements.length) await db.batch(statements, "write");
  await run("UPDATE pluggy_items SET last_sync = datetime('now') WHERE id = ?", [item.id]);
  res.json({ ok: true, contasEncontradas: accounts.length, transacoesProcessadas: novasTransacoes });
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
        const accResp = await fetch(`${PLUGGY_BASE_URL}/accounts?itemId=${item.item_id}`, { headers: { "X-API-KEY": apiKey } });
        if (!accResp.ok) continue;
        const { results: accounts } = await accResp.json();
        const statements = [];
        for (const acc of accounts) {
          const txResp = await fetch(`${PLUGGY_BASE_URL}/transactions?accountId=${acc.id}&pageSize=200`, { headers: { "X-API-KEY": apiKey } });
          if (!txResp.ok) continue;
          const { results: pluggyTx } = await txResp.json();
          for (const t of pluggyTx) {
            const desc = t.description || "Transação";
            statements.push({
              sql: `INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category)
                    SELECT ?,?,?,?,?,?,?
                    WHERE NOT EXISTS (
                      SELECT 1 FROM transactions WHERE user_id = ? AND date = ? AND desc = ? AND value = ?
                    )`,
              args: [
                item.user_id, t.date?.slice(0, 10), desc, item.item_id, t.amount, t.amount >= 0 ? "entrada" : "saida", categorize(desc),
                item.user_id, t.date?.slice(0, 10), desc, t.amount
              ]
            });
          }
        }
        if (statements.length) await db.batch(statements, "write");
        await run("UPDATE pluggy_items SET last_sync = datetime('now') WHERE id = ?", [item.id]);
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
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`FinanApp backend rodando em http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("Erro ao inicializar o banco:", e);
    process.exit(1);
  });
