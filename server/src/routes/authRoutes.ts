import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import { signToken, requireAuth, type AuthedRequest } from "../auth.js";

export const authRouter = Router();

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
}

authRouter.post("/register", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string") {
    return res.status(400).json({ error: "email, password, and name are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)").run(
    id,
    normalizedEmail,
    passwordHash,
    name.trim()
  );

  const inboxId = uuid();
  db.prepare(
    "INSERT INTO lists (id, user_id, name, color, sort_order, is_inbox) VALUES (?, ?, 'Inbox', '#3b82f6', 0, 1)"
  ).run(inboxId, id);

  const token = signToken(id);
  res.status(201).json({ token, user: { id, email: normalizedEmail, name: name.trim() } });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password are required" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail) as
    | UserRow
    | undefined;
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = db
    .prepare("SELECT id, email, name FROM users WHERE id = ?")
    .get(req.userId) as Omit<UserRow, "password_hash"> | undefined;
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});
