"use strict";
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
app.disable("x-powered-by");
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "admin.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

if (JWT_SECRET.length < 48) {
  console.error("JWT_SECRET must contain at least 48 random characters.");
  process.exit(1);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      connectSrc: ["'self'", "https://haxreseller-production.up.railway.app"]
    }
  }
}));
if (allowedOrigins.length) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS."));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
}
app.use(express.json({ limit: "12kb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "محاولات دخول كثيرة. حاول لاحقاً." }
});

let writeQueue = Promise.resolve();

async function readAdmin() {
  return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
}
function withAdmin(operation) {
  const task = writeQueue.then(async () => {
    const admin = await readAdmin();
    const result = await operation(admin);
    const temp = DATA_FILE + "." + crypto.randomBytes(5).toString("hex") + ".tmp";
    await fs.writeFile(temp, JSON.stringify(admin, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, DATA_FILE);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function passwordIsStrong(password) {
  return typeof password === "string" &&
    password.length >= 14 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) &&
    /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}
function issueToken(admin) {
  return jwt.sign(
    { sub: "admin", sessionVersion: admin.sessionVersion },
    JWT_SECRET,
    { expiresIn: "30m", issuer: "hax-password" }
  );
}
async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "سجّل الدخول أولاً." });
    const payload = jwt.verify(token, JWT_SECRET, { issuer: "hax-password" });
    if (payload.sub !== "admin") return res.status(401).json({ error: "جلسة غير صالحة." });
    const admin = await readAdmin();
    if (payload.sessionVersion !== admin.sessionVersion) return res.status(401).json({ error: "تم إبطال هذه الجلسة. سجّل الدخول مجدداً." });
    req.admin = admin;
    next();
  } catch {
    return res.status(401).json({ error: "انتهت الجلسة أو لم تعد صالحة." });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "HAX_PASSWORD" }));

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  try {
    const admin = await readAdmin();
    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);
    if (username !== admin.username || !passwordMatch) {
      return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }
    return res.json({ token: issueToken(admin), expiresIn: 1800 });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ error: "تعذر إكمال تسجيل الدخول." });
  }
});

app.get("/api/security/status", requireAdmin, async (req, res) => {
  res.json({
    username: req.admin.username,
    lastChangedAt: req.admin.lastChangedAt || null,
    sessionPolicy: "All previous sessions are invalidated after a password change."
  });
});

app.post("/api/password/change", requireAdmin, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!passwordIsStrong(newPassword)) {
    return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تحتوي على 14 حرفاً على الأقل، وحروف كبيرة وصغيرة ورقماً ورمزاً." });
  }
  if (currentPassword === newPassword) return res.status(400).json({ error: "اختر كلمة مرور مختلفة عن الحالية." });

  try {
    const newHash = await bcrypt.hash(newPassword, 12);
    const result = await withAdmin(async admin => {
      const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
      if (!valid) return { error: "كلمة المرور الحالية غير صحيحة." };
      admin.passwordHash = newHash;
      admin.sessionVersion += 1;
      admin.lastChangedAt = new Date().toISOString();
      return { changed: true, token: issueToken(admin), lastChangedAt: admin.lastChangedAt };
    });
    if (result.error) return res.status(401).json({ error: result.error });
    return res.json({ ok: true, token: result.token, lastChangedAt: result.lastChangedAt, message: "تم تغيير كلمة المرور وإبطال الجلسات السابقة." });
  } catch (error) {
    console.error("Password change error:", error.message);
    return res.status(500).json({ error: "تعذر تحديث كلمة المرور." });
  }
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
app.use((error, _req, res, _next) => {
  console.error(error.message);
  if (res.headersSent) return;
  const status = error.message === "Origin is not allowed by CORS." ? 403 : 500;
  res.status(status).json({ error: status === 403 ? "هذا النطاق غير مسموح." : "حدث خطأ داخلي." });
});

async function start() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
    console.log("Existing administrator record loaded.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const username = process.env.BOOTSTRAP_ADMIN_USERNAME || "";
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
    if (!username || !password || password.length < 14) {
      console.error("First start requires BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (14+ characters).");
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await fs.writeFile(DATA_FILE, JSON.stringify({
      username, passwordHash, sessionVersion: 1, lastChangedAt: null,
      createdAt: new Date().toISOString()
    }, null, 2), { encoding: "utf8", mode: 0o600 });
  }
  app.listen(PORT, () => console.log("HAX_PASSWORD listening on port " + PORT));
}
start().catch(error => { console.error("Startup failed:", error); process.exit(1); });
