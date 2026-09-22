import type { Task } from "../types";

const PRIORITY_COLORS: Record<number, string> = {
  5: "#e11d48",
  3: "#f59e0b",
  1: "#3b82f6",
  0: "transparent",
};

function formatDue(dueDate: string | null) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dueDate === today) return { label: "Today", overdue: false };
  if (dueDate === tomorrow) return { label: "Tomorrow", overdue: false };
  return { label: dueDate, overdue: dueDate < today };
}

function TaskLine({
  task,
  onSelect,
  onToggleComplete,
  indent,
  selected,
}: {
  task: Task;
  onSelect: () => void;
  onToggleComplete: (task: Task) => void;
  indent: boolean;
  selected: boolean;
}) {
  const due = formatDue(task.dueDate);
  return (
    <div
      className={`task-row ${selected ? "selected" : ""} ${indent ? "indent" : ""}`}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={task.isCompleted}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleComplete(task)}
        style={{ accentColor: PRIORITY_COLORS[task.priority] ?? undefined }}
      />
      <div className="task-row-main">
        <span className={`task-title ${task.isCompleted ? "completed" : ""}`}>{task.title}</span>
        <div className="task-meta">
          {due && <span className={`due-badge ${due.overdue ? "overdue" : ""}`}>{due.label}</span>}
          {task.recurringFreq && <span className="recur-badge">↻</span>}
          {task.tags.map((tag) => (
            <span key={tag.id} className="tag-badge" style={{ borderColor: tag.color }}>
              #{tag.name}
            </span>
          ))}
        </div>
      </div>
      {task.priority > 0 && (
        <span className="priority-flag" style={{ color: PRIORITY_COLORS[task.priority] }}>
          ▲
        </span>
      )}
    </div>
  );
}

export function TaskRow({
  task,
  subtasks,
  selected,
  onSelect,
  onToggleComplete,
}: {
  task: Task;
  subtasks: Task[];
  selected: boolean;
  onSelect: () => void;
  onToggleComplete: (task: Task) => void;
}) {
  return (
    <li>
      <TaskLine
        task={task}
        selected={selected}
        onSelect={onSelect}
        onToggleComplete={onToggleComplete}
        indent={false}
      />
      {subtasks.length > 0 && (
        <ul className="subtask-list">
          {subtasks.map((sub) => (
            <li key={sub.id}>
              <TaskLine
                task={sub}
                selected={false}
                onSelect={onSelect}
                onToggleComplete={onToggleComplete}
                indent
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
