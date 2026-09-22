import { useEffect, useState } from "react";
import { api } from "../api";
import type { Tag, Task, TaskList, RecurringFreq } from "../types";

export function TaskDetail({
  task,
  lists,
  tags,
  priorityLabels,
  priorityValues,
  onClose,
  onChanged,
  onTagsChanged,
}: {
  task: Task;
  lists: TaskList[];
  tags: Tag[];
  priorityLabels: string[];
  priorityValues: number[];
  onClose: () => void;
  onChanged: () => void;
  onTagsChanged: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [listId, setListId] = useState(task.listId);
  const [recurringFreq, setRecurringFreq] = useState<RecurringFreq | "">(task.recurringFreq ?? "");
  const [recurringInterval, setRecurringInterval] = useState(task.recurringInterval ?? 1);
  const [tagInput, setTagInput] = useState("");
  const [newSubtask, setNewSubtask] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
    setDueDate(task.dueDate ?? "");
    setPriority(task.priority);
    setListId(task.listId);
    setRecurringFreq(task.recurringFreq ?? "");
    setRecurringInterval(task.recurringInterval ?? 1);
  }, [task]);

  async function save(patch: Partial<Parameters<typeof api.updateTask>[1]>) {
    await api.updateTask(task.id, patch);
    onChanged();
  }

  async function handleAddTag() {
    const name = tagInput.trim();
    if (!name) return;
    const { tag } = await api.createTag(name);
    setTagInput("");
    const nextTagIds = [...task.tags.map((t) => t.id), tag.id];
    await save({ tagIds: nextTagIds });
    onTagsChanged();
  }

  async function handleRemoveTag(tagId: string) {
    const nextTagIds = task.tags.filter((t) => t.id !== tagId).map((t) => t.id);
    await save({ tagIds: nextTagIds });
  }

  async function handleAddSubtask() {
    const t = newSubtask.trim();
    if (!t) return;
    setNewSubtask("");
    await api.createTask({ listId: task.listId, title: t, parentId: task.id });
    onChanged();
  }

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    await api.deleteTask(task.id);
    onClose();
    onChanged();
  }

  return (
    <aside className="task-detail">
      <div className="task-detail-header">
        <button className="link-btn" onClick={onClose}>
          Close
        </button>
        <button className="link-btn danger" onClick={handleDelete}>
          Delete
        </button>
      </div>

      <input
        className="detail-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => save({ title })}
      />

      <textarea
        className="detail-notes"
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => save({ notes })}
      />

      <div className="detail-field">
        <label>List</label>
        <select
          value={listId}
          onChange={(e) => {
            setListId(e.target.value);
            save({ listId: e.target.value });
          }}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="detail-field">
        <label>Due date</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => {
            setDueDate(e.target.value);
            save({ dueDate: e.target.value || null });
          }}
        />
      </div>

      <div className="detail-field">
        <label>Priority</label>
        <div className="priority-picker">
          {priorityValues.map((v, i) => (
            <button
              key={v}
              className={`priority-btn ${priority === v ? "active" : ""}`}
              onClick={() => {
                setPriority(v);
                save({ priority: v });
              }}
            >
              {priorityLabels[i]}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-field">
        <label>Eisenhower Matrix</label>
        <div className="matrix-toggle-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={task.isUrgent}
              onChange={(e) => save({ isUrgent: e.target.checked })}
            />
            Urgent
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={task.isImportant}
              onChange={(e) => save({ isImportant: e.target.checked })}
            />
            Important
          </label>
        </div>
      </div>

      <div className="detail-field">
        <label>Repeat</label>
        <div className="repeat-row">
          <select
            value={recurringFreq}
            onChange={(e) => {
              const val = e.target.value as RecurringFreq | "";
              setRecurringFreq(val);
              save({ recurringFreq: val || null, recurringInterval: val ? recurringInterval : null });
            }}
          >
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          {recurringFreq && (
            <>
              <span>every</span>
              <input
                type="number"
                min={1}
                value={recurringInterval}
                onChange={(e) => {
                  const n = Number(e.target.value) || 1;
                  setRecurringInterval(n);
                  save({ recurringInterval: n });
                }}
              />
            </>
          )}
        </div>
      </div>

      <div className="detail-field">
        <label>Tags</label>
        <div className="tag-list">
          {task.tags.map((t) => (
            <span key={t.id} className="tag-chip" style={{ borderColor: t.color }}>
              #{t.name}
              <button onClick={() => handleRemoveTag(t.id)}>×</button>
            </span>
          ))}
        </div>
        <div className="tag-input-row">
          <input
            list="tag-options"
            placeholder="Add tag"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
          />
          <datalist id="tag-options">
            {tags.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <button onClick={handleAddTag}>Add</button>
        </div>
      </div>

      {!task.parentId && (
        <div className="detail-field">
          <label>Subtasks</label>
          <div className="tag-input-row">
            <input
              placeholder="Add subtask"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddSubtask()}
            />
            <button onClick={handleAddSubtask}>Add</button>
          </div>
        </div>
      )}
    </aside>
  );
}
