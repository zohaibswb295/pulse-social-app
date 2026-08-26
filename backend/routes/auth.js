const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
  };
}

// POST /api/auth/signup
router.post("/signup", (req, res) => {
  const { username, email, password, displayName } = req.body || {};

  if (!username || !email || !password || !displayName) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: "Username must be 3-20 characters: letters, numbers, _ or . only.",
    });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ? OR email = ?")
    .get(username.toLowerCase(), email.toLowerCase());

  if (existing) {
    return res.status(409).json({ error: "Username or email is already taken." });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarSeed = Math.random().toString(36).slice(2, 10);

  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, display_name, avatar_seed)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username.toLowerCase(), email.toLowerCase(), passwordHash, displayName, avatarSeed);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: "Enter your username/email and password." });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ? OR email = ?")
    .get(identifier.toLowerCase(), identifier.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username/email or password." });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

module.exports = router;
