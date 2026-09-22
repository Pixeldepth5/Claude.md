import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

export const tagRouter = Router();
tagRouter.use(requireAuth);

tagRouter.get("/", (req: AuthedRequest, res) => {
  const tags = db.prepare("SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC").all(req.userId);
  res.json({ tags });
});

tagRouter.post("/", (req: AuthedRequest, res) => {
  const { name, color } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const existing = db
    .prepare("SELECT * FROM tags WHERE user_id = ? AND name = ?")
    .get(req.userId, name.trim());
  if (existing) return res.status(200).json({ tag: existing });

  const id = uuid();
  db.prepare("INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)").run(
    id,
    req.userId,
    name.trim(),
    typeof color === "string" ? color : "#8b5cf6"
  );
  const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  res.status(201).json({ tag });
});

tagRouter.delete("/:id", (req: AuthedRequest, res) => {
  const tag = db
    .prepare("SELECT * FROM tags WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!tag) return res.status(404).json({ error: "Tag not found" });
  db.prepare("DELETE FROM tags WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
