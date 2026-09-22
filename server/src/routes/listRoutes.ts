import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

export const listRouter = Router();
listRouter.use(requireAuth);

listRouter.get("/", (req: AuthedRequest, res) => {
  const lists = db
    .prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC")
    .all(req.userId);
  res.json({ lists });
});

listRouter.post("/", (req: AuthedRequest, res) => {
  const { name, color } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const id = uuid();
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM lists WHERE user_id = ?")
    .get(req.userId) as { m: number };
  db.prepare(
    "INSERT INTO lists (id, user_id, name, color, sort_order, is_inbox) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(id, req.userId, name.trim(), typeof color === "string" ? color : "#3b82f6", maxOrder.m + 1);
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
  res.status(201).json({ list });
});

listRouter.put("/:id", (req: AuthedRequest, res) => {
  const list = db
    .prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!list) return res.status(404).json({ error: "List not found" });
  const { name, color, sort_order } = req.body ?? {};
  db.prepare(
    "UPDATE lists SET name = COALESCE(?, name), color = COALESCE(?, color), sort_order = COALESCE(?, sort_order) WHERE id = ?"
  ).run(
    typeof name === "string" ? name.trim() : null,
    typeof color === "string" ? color : null,
    typeof sort_order === "number" ? sort_order : null,
    req.params.id
  );
  const updated = db.prepare("SELECT * FROM lists WHERE id = ?").get(req.params.id);
  res.json({ list: updated });
});

listRouter.delete("/:id", (req: AuthedRequest, res) => {
  const list = db
    .prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as { is_inbox: number } | undefined;
  if (!list) return res.status(404).json({ error: "List not found" });
  if (list.is_inbox) return res.status(400).json({ error: "Cannot delete the Inbox list" });
  db.prepare("DELETE FROM lists WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
