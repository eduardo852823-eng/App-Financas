/* ============================================================
   FinanHub — backend
   Node.js + Express + SQLite (better-sqlite3)
   Guarda: usuários (login por e-mail ou Google), preferências
   (tema, etc.), instituições conectadas e transações.
   ============================================================ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET || "troque_essa_chave_em_producao";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "732987980412-3caubvvgvknj05hpl5mb5p2lcfs3b3pm.apps.googleusercontent.com";
const PORT = process.env.PORT || 3001;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express();
app.use(cors());
app.use(express.json());

/* ============================================================
   BANCO DE DADOS
   ============================================================ */
const db = new Database(path.join(__dirname, "finanhub.db"));
db.pragma("journal_mode = WAL");

db.exec(`
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
`);

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
   GERADOR DE TRANSAÇÕES
   modoTeste=true -> valores bem menores (pra não assustar em testes)
   ============================================================ */
const OUT_DESCS = [
  ["IFOOD", "alimentacao"], ["UBER", "transporte"], ["STEAM", "entretenimento"],
  ["NETFLIX", "entretenimento"], ["POSTO SHELL", "transporte"], ["MERCADO EXTRA", "alimentacao"],
  ["FARMACIA SP", "saude"], ["AMAZON", "compras"], ["CONTA DE LUZ", "contas"],
  ["INTERNET FIBRA", "contas"], ["RESTAURANTE", "alimentacao"], ["SHOPEE", "compras"],
  ["CURSO ONLINE", "educacao"], ["ACADEMIA", "saude"]
];
const IN_DESCS = ["PIX recebido", "Salário", "Pagamento recebido"];

function generateTransactionsForBank(userId, bankId, { months = 6, modoTeste = false } = {}) {
  const insert = db.prepare(`INSERT INTO transactions (user_id, date, desc, bank_id, value, type, category) VALUES (?,?,?,?,?,?,?)`);
  const fatorTeste = modoTeste ? 0.1 : 1; // valores 10x menores no modo teste
  const now = new Date();
  const rows = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = d.getFullYear(), month = d.getMonth();
    // salário garantido no mês
    rows.push([userId, dateStr(year, month, 3), "Salário", bankId, roundVal((1800 + Math.random() * 1200) * fatorTeste), "entrada", "salario"]);
    const numTx = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numTx; i++) {
      const day = 1 + Math.floor(Math.random() * 27);
      if (Math.random() < 0.12) {
        const desc = IN_DESCS[Math.floor(Math.random() * IN_DESCS.length)];
        rows.push([userId, dateStr(year, month, day), desc, bankId, roundVal((50 + Math.random() * 300) * fatorTeste), "entrada", "salario"]);
      } else {
        const [desc, cat] = OUT_DESCS[Math.floor(Math.random() * OUT_DESCS.length)];
        rows.push([userId, dateStr(year, month, day), desc, bankId, -roundVal((15 + Math.random() * 220) * fatorTeste), "saida", cat]);
      }
    }
  }
  const tx = db.transaction((items) => { for (const it of items) insert.run(...it); });
  tx(rows);
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
function ensureDefaultsForUser(userId, { comDados = true } = {}) {
  const connectedIds = comDados ? ["inter", "nubank"] : [];
  const insertInst = db.prepare(`INSERT OR IGNORE INTO institutions (user_id, bank_id, connected) VALUES (?,?,?)`);
  ALL_INSTITUTIONS.forEach(i => insertInst.run(userId, i.id, connectedIds.includes(i.id) ? 1 : 0));
  db.prepare(`INSERT OR IGNORE INTO preferences (user_id) VALUES (?)`).run(userId);
  if (comDados) connectedIds.forEach(bankId => generateTransactionsForBank(userId, bankId, { months: 8 }));
}

/* ---------- registro por e-mail ---------- */
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Preencha nome, e-mail e senha" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?,?,?)").run(name, email, hash);
  ensureDefaultsForUser(info.lastInsertRowid, { comDados: true });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ token: makeToken(user), user: publicUser(user) });
});

/* ---------- login por e-mail ---------- */
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "E-mail ou senha incorretos" });
  }
  res.json({ token: makeToken(user), user: publicUser(user) });
});

/* ---------- login com Google ---------- */
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Credencial do Google ausente" });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(payload.email);
    if (!user) {
      const info = db.prepare("INSERT INTO users (name, email, google_id, avatar) VALUES (?,?,?,?)")
        .run(payload.name || "Usuário Google", payload.email, payload.sub, payload.picture || null);
      ensureDefaultsForUser(info.lastInsertRowid, { comDados: true });
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    } else if (!user.google_id) {
      db.prepare("UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?").run(payload.sub, payload.picture || null, user.id);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    }
    res.json({ token: makeToken(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: "Não foi possível validar o login do Google" });
  }
});

/* ============================================================
   PERFIL / PREFERÊNCIAS
   ============================================================ */
app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const prefs = db.prepare("SELECT * FROM preferences WHERE user_id = ?").get(req.userId);
  res.json({ user: publicUser(user), preferences: prefs || { theme: "light", currency: "BRL" } });
});
app.put("/api/me/preferences", auth, (req, res) => {
  const { theme, currency } = req.body;
  db.prepare(`INSERT INTO preferences (user_id, theme, currency) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, currency = excluded.currency`)
    .run(req.userId, theme || "light", currency || "BRL");
  res.json({ ok: true });
});

/* ============================================================
   INSTITUIÇÕES (BANCOS)
   ============================================================ */
app.get("/api/institutions", auth, (req, res) => {
  const rows = db.prepare("SELECT bank_id, connected, last_sync FROM institutions WHERE user_id = ?").all(req.userId);
  const map = Object.fromEntries(rows.map(r => [r.bank_id, r]));
  const result = ALL_INSTITUTIONS.map(i => ({
    ...i,
    connected: !!(map[i.id] && map[i.id].connected),
    last_sync: map[i.id] ? map[i.id].last_sync : null
  }));
  res.json(result);
});

app.post("/api/institutions/:bankId/toggle", auth, (req, res) => {
  const { bankId } = req.params;
  const { modoTeste } = req.body || {};
  if (!ALL_INSTITUTIONS.some(i => i.id === bankId)) return res.status(404).json({ error: "Banco não encontrado" });
  const row = db.prepare("SELECT * FROM institutions WHERE user_id = ? AND bank_id = ?").get(req.userId, bankId);
  const newConnected = row ? !row.connected : true;
  db.prepare(`INSERT INTO institutions (user_id, bank_id, connected, last_sync) VALUES (?,?,?,?)
    ON CONFLICT(user_id, bank_id) DO UPDATE SET connected = excluded.connected, last_sync = excluded.last_sync`)
    .run(req.userId, bankId, newConnected ? 1 : 0, newConnected ? new Date().toISOString() : row?.last_sync || null);

  // ao conectar um banco que nunca teve transações, já popula com um extrato
  // (em vez de vir "zerado") — no futuro isso é substituído pela consulta
  // real ao Open Finance.
  if (newConnected) {
    const hasTx = db.prepare("SELECT 1 FROM transactions WHERE user_id = ? AND bank_id = ? LIMIT 1").get(req.userId, bankId);
    if (!hasTx) generateTransactionsForBank(req.userId, bankId, { months: 6, modoTeste: !!modoTeste });
  }
  res.json({ connected: newConnected });
});

/* ============================================================
   TRANSAÇÕES
   ============================================================ */
app.get("/api/transactions", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC").all(req.userId);
  res.json(rows);
});

app.put("/api/transactions/:id/category", auth, (req, res) => {
  const { category } = req.body;
  const info = db.prepare("UPDATE transactions SET category = ? WHERE id = ? AND user_id = ?").run(category, req.params.id, req.userId);
  if (!info.changes) return res.status(404).json({ error: "Transação não encontrada" });
  res.json({ ok: true });
});

app.delete("/api/transactions/:id", auth, (req, res) => {
  const info = db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  if (!info.changes) return res.status(404).json({ error: "Transação não encontrada" });
  res.json({ ok: true });
});

/* ---------- modo demonstração (repõe tudo com dados de exemplo) ---------- */
app.post("/api/demo", auth, (req, res) => {
  const { modoTeste } = req.body || {};
  db.prepare("DELETE FROM transactions WHERE user_id = ?").run(req.userId);
  const banks = ["inter", "nubank", "caixa", "bb"];
  const upsertInst = db.prepare(`INSERT INTO institutions (user_id, bank_id, connected) VALUES (?,?,?)
    ON CONFLICT(user_id, bank_id) DO UPDATE SET connected = excluded.connected`);
  ALL_INSTITUTIONS.forEach(i => upsertInst.run(req.userId, i.id, banks.includes(i.id) ? 1 : 0));
  banks.forEach(bankId => generateTransactionsForBank(req.userId, bankId, { months: 8, modoTeste: !!modoTeste }));
  res.json({ ok: true });
});

/* ============================================================
   OPEN FINANCE (placeholder)
   A ideia final: a cada 5 minutos, para cada instituição conectada
   com consentimento válido, chamar o endpoint oficial do Open
   Finance do banco, comparar com a última transação sincronizada
   (last_sync) e inserir só o que for novo. Por enquanto isso é
   simulado por generateTransactionsForBank() acima.
   ============================================================ */
function syncOpenFinancePlaceholder() {
  // TODO: substituir por chamadas reais aos adaptadores de cada banco
  // quando o Open Finance oficial estiver integrado.
  console.log("[open-finance] verificação periódica (placeholder) —", new Date().toISOString());
}
setInterval(syncOpenFinancePlaceholder, 5 * 60 * 1000);

app.listen(PORT, () => console.log(`FinanHub backend rodando em http://localhost:${PORT}`));
