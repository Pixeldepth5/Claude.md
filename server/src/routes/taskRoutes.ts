import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { nextDueDate, type RecurringFreq } from "../recurrence.js";

export const taskRouter = Router();
taskRouter.use(requireAuth);

interface TaskRow {
  id: string;
  user_id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string;
  due_date: string | null;
  priority: number;
  recurring_freq: RecurringFreq | null;
  recurring_interval: number | null;
  is_completed: number;
  completed_at: string | null;
  is_urgent: number;
  is_important: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function tagsForTasks(taskIds: string[]): Map<string, { id: string; name: string; color: string }[]> {
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  if (taskIds.length === 0) return map;
  const placeholders = taskIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT tt.task_id AS task_id, t.id AS id, t.name AS name, t.color AS color
       FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
       WHERE tt.task_id IN (${placeholders})`
    )
    .all(...taskIds) as { task_id: string; id: string; name: string; color: string }[];
  for (const row of rows) {
    const list = map.get(row.task_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.task_id, list);
  }
  return map;
}

function serialize(task: TaskRow, tagMap: Map<string, { id: string; name: string; color: string }[]>) {
  return {
    id: task.id,
    listId: task.list_id,
    parentId: task.parent_id,
    title: task.title,
    notes: task.notes,
    dueDate: task.due_date,
    priority: task.priority,
    recurringFreq: task.recurring_freq,
    recurringInterval: task.recurring_interval,
    isCompleted: !!task.is_completed,
    completedAt: task.completed_at,
    isUrgent: !!task.is_urgent,
    isImportant: !!task.is_important,
    sortOrder: task.sort_order,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    tags: tagMap.get(task.id) ?? [],
  };
}

function setTaskTags(taskId: string, tagIds: unknown) {
  db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
  if (Array.isArray(tagIds)) {
    const stmt = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) {
      if (typeof tagId === "string") stmt.run(taskId, tagId);
    }
  }
}

taskRouter.get("/", (req: AuthedRequest, res) => {
  const { listId, tag, smart, includeCompleted } = req.query as Record<string, string | undefined>;

  let query = "SELECT * FROM tasks WHERE user_id = ?";
  const params: unknown[] = [req.userId];

  if (listId) {
    query += " AND list_id = ?";
    params.push(listId);
  }

  if (includeCompleted !== "true") {
    query += " AND is_completed = 0";
  }

  const today = new Date().toISOString().slice(0, 10);
  if (smart === "today") {
    query += " AND due_date <= ?";
    params.push(today);
  } else if (smart === "next7") {
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    query += " AND due_date IS NOT NULL AND due_date <= ?";
    params.push(in7);
  } else if (smart === "priority") {
    query += " AND priority >= 3";
  }

  query += " ORDER BY sort_order ASC, created_at ASC";

  let tasks = db.prepare(query).all(...params) as TaskRow[];

  if (tag) {
    const taggedIds = new Set(
      (
        db
          .prepare(
            "SELECT task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.user_id = ? AND t.name = ?"
          )
          .all(req.userId, tag) as { task_id: string }[]
      ).map((r) => r.task_id)
    );
    tasks = tasks.filter((t) => taggedIds.has(t.id));
  }

  const tagMap = tagsForTasks(tasks.map((t) => t.id));
  res.json({ tasks: tasks.map((t) => serialize(t, tagMap)) });
});

taskRouter.post("/", (req: AuthedRequest, res) => {
  const {
    listId,
    title,
    notes,
    dueDate,
    priority,
    parentId,
    recurringFreq,
    recurringInterval,
    tagIds,
    isUrgent,
    isImportant,
  } = req.body ?? {};

  if (typeof listId !== "string" || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "listId and title are required" });
  }
  const list = db.prepare("SELECT id FROM lists WHERE id = ? AND user_id = ?").get(listId, req.userId);
  if (!list) return res.status(404).json({ error: "List not found" });

  if (parentId) {
    const parent = db
      .prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?")
      .get(parentId, req.userId);
    if (!parent) return res.status(404).json({ error: "Parent task not found" });
  }

  const id = uuid();
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM tasks WHERE list_id = ?")
    .get(listId) as { m: number };

  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, priority, recurring_freq, recurring_interval, is_urgent, is_important, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.userId,
    listId,
    typeof parentId === "string" ? parentId : null,
    title.trim(),
    typeof notes === "string" ? notes : "",
    typeof dueDate === "string" ? dueDate : null,
    typeof priority === "number" ? priority : 0,
    typeof recurringFreq === "string" ? recurringFreq : null,
    typeof recurringInterval === "number" ? recurringInterval : null,
    isUrgent ? 1 : 0,
    isImportant ? 1 : 0,
    maxOrder.m + 1
  );
  setTaskTags(id, tagIds);

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
  const tagMap = tagsForTasks([id]);
  res.status(201).json({ task: serialize(task, tagMap) });
});

taskRouter.put("/:id", (req: AuthedRequest, res) => {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as TaskRow | undefined;
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const {
    title,
    notes,
    dueDate,
    priority,
    listId,
    recurringFreq,
    recurringInterval,
    tagIds,
    sortOrder,
    isUrgent,
    isImportant,
  } = req.body ?? {};

  db.prepare(
    `UPDATE tasks SET
      title = COALESCE(?, title),
      notes = COALESCE(?, notes),
      due_date = ?,
      priority = COALESCE(?, priority),
      list_id = COALESCE(?, list_id),
      recurring_freq = ?,
      recurring_interval = ?,
      sort_order = COALESCE(?, sort_order),
      is_urgent = COALESCE(?, is_urgent),
      is_important = COALESCE(?, is_important),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    typeof title === "string" ? title.trim() : null,
    typeof notes === "string" ? notes : null,
    dueDate === undefined ? existing.due_date : dueDate,
    typeof priority === "number" ? priority : null,
    typeof listId === "string" ? listId : null,
    recurringFreq === undefined ? existing.recurring_freq : recurringFreq,
    recurringInterval === undefined ? existing.recurring_interval : recurringInterval,
    typeof sortOrder === "number" ? sortOrder : null,
    typeof isUrgent === "boolean" ? (isUrgent ? 1 : 0) : null,
    typeof isImportant === "boolean" ? (isImportant ? 1 : 0) : null,
    req.params.id
  );

  if (tagIds !== undefined) setTaskTags(String(req.params.id), tagIds);

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as TaskRow;
  const tagMap = tagsForTasks([task.id]);
  res.json({ task: serialize(task, tagMap) });
});

taskRouter.post("/:id/complete", (req: AuthedRequest, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as TaskRow | undefined;
  if (!task) return res.status(404).json({ error: "Task not found" });

  const incompleteSubtasks = db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE parent_id = ? AND is_completed = 0")
    .get(task.id) as { c: number };
  if (incompleteSubtasks.c > 0) {
    return res.status(400).json({ error: "Complete all subtasks first" });
  }

  db.prepare(
    "UPDATE tasks SET is_completed = 1, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(task.id);

  let created: TaskRow | null = null;
  if (task.recurring_freq && task.recurring_interval && task.due_date) {
    const newDue = nextDueDate(task.due_date, task.recurring_freq, task.recurring_interval);
    const newId = uuid();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, notes, due_date, priority, recurring_freq, recurring_interval, is_urgent, is_important, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId,
      task.user_id,
      task.list_id,
      task.parent_id,
      task.title,
      task.notes,
      newDue,
      task.priority,
      task.recurring_freq,
      task.recurring_interval,
      task.is_urgent,
      task.is_important,
      task.sort_order
    );
    const existingTags = db.prepare("SELECT tag_id FROM task_tags WHERE task_id = ?").all(task.id) as {
      tag_id: string;
    }[];
    setTaskTags(
      newId,
      existingTags.map((t) => t.tag_id)
    );
    created = db.prepare("SELECT * FROM tasks WHERE id = ?").get(newId) as TaskRow;
  }

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as TaskRow;
  const ids = created ? [updated.id, created.id] : [updated.id];
  const tagMap = tagsForTasks(ids);
  res.json({
    task: serialize(updated, tagMap),
    nextOccurrence: created ? serialize(created, tagMap) : null,
  });
});

taskRouter.post("/:id/uncomplete", (req: AuthedRequest, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  db.prepare(
    "UPDATE tasks SET is_completed = 0, completed_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as TaskRow;
  const tagMap = tagsForTasks([updated.id]);
  res.json({ task: serialize(updated, tagMap) });
});

taskRouter.delete("/:id", (req: AuthedRequest, res) => {
  const task = db
    .prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
