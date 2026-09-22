import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { computeStreak } from "../habitStreak.js";

export const habitRouter = Router();
habitRouter.use(requireAuth);

interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  frequency: string;
  days_of_week: string | null;
  archived: number;
  sort_order: number;
  created_at: string;
}

function serialize(habit: HabitRow, checkins: string[]) {
  const daysOfWeek = habit.days_of_week ? (JSON.parse(habit.days_of_week) as number[]) : null;
  return {
    id: habit.id,
    name: habit.name,
    color: habit.color,
    frequency: habit.frequency,
    daysOfWeek,
    archived: !!habit.archived,
    sortOrder: habit.sort_order,
    createdAt: habit.created_at,
    checkins,
    streak: computeStreak(new Set(checkins), habit.frequency, daysOfWeek),
  };
}

habitRouter.get("/", (req: AuthedRequest, res) => {
  const days = Math.min(Number(req.query.days) || 35, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const habits = db
    .prepare("SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY sort_order ASC, created_at ASC")
    .all(req.userId) as HabitRow[];

  const checkinRows = db
    .prepare(
      `SELECT habit_id, date FROM habit_checkins
       WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?) AND date >= ?`
    )
    .all(req.userId, since) as { habit_id: string; date: string }[];

  const checkinsByHabit = new Map<string, string[]>();
  for (const row of checkinRows) {
    const arr = checkinsByHabit.get(row.habit_id) ?? [];
    arr.push(row.date);
    checkinsByHabit.set(row.habit_id, arr);
  }

  res.json({ habits: habits.map((h) => serialize(h, checkinsByHabit.get(h.id) ?? [])) });
});

habitRouter.post("/", (req: AuthedRequest, res) => {
  const { name, color, frequency, daysOfWeek } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const freq = frequency === "custom" ? "custom" : "daily";
  const id = uuid();
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM habits WHERE user_id = ?")
    .get(req.userId) as { m: number };

  db.prepare(
    "INSERT INTO habits (id, user_id, name, color, frequency, days_of_week, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.userId,
    name.trim(),
    typeof color === "string" ? color : "#10b981",
    freq,
    freq === "custom" && Array.isArray(daysOfWeek) ? JSON.stringify(daysOfWeek) : null,
    maxOrder.m + 1
  );

  const habit = db.prepare("SELECT * FROM habits WHERE id = ?").get(id) as HabitRow;
  res.status(201).json({ habit: serialize(habit, []) });
});

habitRouter.put("/:id", (req: AuthedRequest, res) => {
  const existing = db
    .prepare("SELECT * FROM habits WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as HabitRow | undefined;
  if (!existing) return res.status(404).json({ error: "Habit not found" });

  const { name, color, frequency, daysOfWeek, archived } = req.body ?? {};
  db.prepare(
    `UPDATE habits SET
      name = COALESCE(?, name),
      color = COALESCE(?, color),
      frequency = COALESCE(?, frequency),
      days_of_week = ?,
      archived = COALESCE(?, archived)
     WHERE id = ?`
  ).run(
    typeof name === "string" ? name.trim() : null,
    typeof color === "string" ? color : null,
    typeof frequency === "string" ? frequency : null,
    daysOfWeek === undefined ? existing.days_of_week : Array.isArray(daysOfWeek) ? JSON.stringify(daysOfWeek) : null,
    typeof archived === "boolean" ? (archived ? 1 : 0) : null,
    req.params.id
  );

  const updated = db.prepare("SELECT * FROM habits WHERE id = ?").get(req.params.id) as HabitRow;
  const checkins = (
    db.prepare("SELECT date FROM habit_checkins WHERE habit_id = ?").all(updated.id) as { date: string }[]
  ).map((r) => r.date);
  res.json({ habit: serialize(updated, checkins) });
});

habitRouter.delete("/:id", (req: AuthedRequest, res) => {
  const habit = db
    .prepare("SELECT id FROM habits WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!habit) return res.status(404).json({ error: "Habit not found" });
  db.prepare("DELETE FROM habits WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

habitRouter.post("/:id/checkin", (req: AuthedRequest, res) => {
  const habit = db
    .prepare("SELECT * FROM habits WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as HabitRow | undefined;
  if (!habit) return res.status(404).json({ error: "Habit not found" });

  const { date } = req.body ?? {};
  const targetDate = typeof date === "string" ? date : new Date().toISOString().slice(0, 10);
  db.prepare("INSERT OR IGNORE INTO habit_checkins (habit_id, date) VALUES (?, ?)").run(
    habit.id,
    targetDate
  );

  const checkins = (
    db.prepare("SELECT date FROM habit_checkins WHERE habit_id = ?").all(habit.id) as { date: string }[]
  ).map((r) => r.date);
  res.status(201).json({ habit: serialize(habit, checkins) });
});

habitRouter.delete("/:id/checkin/:date", (req: AuthedRequest, res) => {
  const habit = db
    .prepare("SELECT * FROM habits WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as HabitRow | undefined;
  if (!habit) return res.status(404).json({ error: "Habit not found" });

  db.prepare("DELETE FROM habit_checkins WHERE habit_id = ? AND date = ?").run(
    habit.id,
    req.params.date
  );

  const checkins = (
    db.prepare("SELECT date FROM habit_checkins WHERE habit_id = ?").all(habit.id) as { date: string }[]
  ).map((r) => r.date);
  res.json({ habit: serialize(habit, checkins) });
});
