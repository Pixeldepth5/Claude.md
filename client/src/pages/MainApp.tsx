import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { SmartView, Tag, Task, TaskList } from "../types";
import { TaskRow } from "../components/TaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { CalendarView } from "./CalendarView";

type ViewSelection =
  | { kind: "smart"; smart: SmartView }
  | { kind: "list"; listId: string }
  | { kind: "tag"; tagName: string }
  | { kind: "calendar" };

const PRIORITY_LABELS = ["None", "Low", "Medium", "High"];
const PRIORITY_VALUES = [0, 1, 3, 5];

export function MainApp() {
  const { user, logout } = useAuth();
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<ViewSelection>({ kind: "smart", smart: "today" });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newListName, setNewListName] = useState("");
  const [showAddList, setShowAddList] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLists = useCallback(() => {
    api.getLists().then(({ lists }) => setLists(lists));
  }, []);
  const refreshTags = useCallback(() => {
    api.getTags().then(({ tags }) => setTags(tags));
  }, []);

  const refreshTasks = useCallback(() => {
    if (view.kind === "calendar") {
      api.getTasks({ includeCompleted: false }).then(({ tasks }) => setTasks(tasks));
      return;
    }
    const params =
      view.kind === "smart"
        ? { smart: view.smart === "all" ? undefined : view.smart }
        : view.kind === "list"
          ? { listId: view.listId }
          : { tag: view.tagName };
    api
      .getTasks(params)
      .then(({ tasks }) => setTasks(tasks))
      .catch((err) => setError(err.message));
  }, [view]);

  useEffect(() => {
    refreshLists();
    refreshTags();
  }, [refreshLists, refreshTags]);

  useEffect(() => {
    refreshTasks();
    setSelectedTaskId(null);
  }, [refreshTasks]);

  const inboxList = lists.find((l) => l.is_inbox);

  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId) {
        const arr = map.get(t.parentId) ?? [];
        arr.push(t);
        map.set(t.parentId, arr);
      }
    }
    return map;
  }, [tasks]);

  async function handleAddTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    const listId = view.kind === "list" ? view.listId : inboxList?.id;
    if (!listId) return;
    setNewTaskTitle("");
    try {
      await api.createTask({ listId, title });
      refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add task");
    }
  }

  async function handleAddList() {
    const name = newListName.trim();
    if (!name) return;
    setNewListName("");
    setShowAddList(false);
    await api.createList(name);
    refreshLists();
  }

  async function handleToggleComplete(task: Task) {
    try {
      if (task.isCompleted) {
        await api.uncompleteTask(task.id);
      } else {
        await api.completeTask(task.id);
      }
      refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    }
  }

  async function handleDeleteList(id: string) {
    if (!confirm("Delete this list and all its tasks?")) return;
    await api.deleteList(id);
    if (view.kind === "list" && view.listId === id) {
      setView({ kind: "smart", smart: "today" });
    }
    refreshLists();
  }

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const viewTitle =
    view.kind === "smart"
      ? { today: "Today", next7: "Next 7 Days", priority: "High Priority", all: "All Tasks" }[view.smart]
      : view.kind === "list"
        ? (lists.find((l) => l.id === view.listId)?.name ?? "List")
        : view.kind === "tag"
          ? `#${view.tagName}`
          : "Calendar";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="brand">TickList</span>
        </div>
        <div className="sidebar-user">
          <span>{user?.name}</span>
          <button className="link-btn" onClick={logout}>
            Log out
          </button>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Smart Lists</div>
          {(["today", "next7", "priority", "all"] as SmartView[]).map((s) => (
            <button
              key={s}
              className={`nav-item ${view.kind === "smart" && view.smart === s ? "active" : ""}`}
              onClick={() => setView({ kind: "smart", smart: s })}
            >
              {{ today: "Today", next7: "Next 7 Days", priority: "High Priority", all: "All Tasks" }[s]}
            </button>
          ))}
          <button
            className={`nav-item ${view.kind === "calendar" ? "active" : ""}`}
            onClick={() => setView({ kind: "calendar" })}
          >
            Calendar
          </button>

          <div className="sidebar-section-label">
            My Lists
            <button className="link-btn small" onClick={() => setShowAddList((s) => !s)}>
              +
            </button>
          </div>
          {showAddList && (
            <div className="add-list-row">
              <input
                autoFocus
                placeholder="List name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddList()}
              />
              <button onClick={handleAddList}>Add</button>
            </div>
          )}
          {lists.map((l) => (
            <div key={l.id} className="nav-item-row">
              <button
                className={`nav-item ${view.kind === "list" && view.listId === l.id ? "active" : ""}`}
                onClick={() => setView({ kind: "list", listId: l.id })}
              >
                <span className="dot" style={{ background: l.color }} />
                {l.name}
              </button>
              {!l.is_inbox && (
                <button className="link-btn small" onClick={() => handleDeleteList(l.id)}>
                  ×
                </button>
              )}
            </div>
          ))}

          <div className="sidebar-section-label">Tags</div>
          {tags.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${view.kind === "tag" && view.tagName === t.name ? "active" : ""}`}
              onClick={() => setView({ kind: "tag", tagName: t.name })}
            >
              <span className="dot" style={{ background: t.color }} />#{t.name}
            </button>
          ))}
        </nav>
      </aside>

      <main className="task-pane">
        <header className="task-pane-header">
          <h2>{viewTitle}</h2>
        </header>
        {error && (
          <div className="error-banner" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        {view.kind === "calendar" ? (
          <CalendarView tasks={tasks} onSelect={setSelectedTaskId} />
        ) : (
          <>
            {view.kind !== "tag" && (
              <div className="add-task-row">
                <input
                  placeholder="+ Add task"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
                />
              </div>
            )}
            <ul className="task-list">
              {topLevelTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  subtasks={subtasksByParent.get(task.id) ?? []}
                  selected={task.id === selectedTaskId}
                  onSelect={() => setSelectedTaskId(task.id)}
                  onToggleComplete={handleToggleComplete}
                />
              ))}
              {topLevelTasks.length === 0 && <li className="empty-state">Nothing here. Nice.</li>}
            </ul>
          </>
        )}
      </main>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          lists={lists}
          tags={tags}
          priorityLabels={PRIORITY_LABELS}
          priorityValues={PRIORITY_VALUES}
          onClose={() => setSelectedTaskId(null)}
          onChanged={refreshTasks}
          onTagsChanged={refreshTags}
        />
      )}
    </div>
  );
}
