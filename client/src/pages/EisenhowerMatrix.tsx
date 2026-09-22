import { api } from "../api";
import type { Task } from "../types";

const QUADRANTS: { key: string; title: string; subtitle: string; urgent: boolean; important: boolean }[] = [
  { key: "do", title: "Do", subtitle: "Urgent & Important", urgent: true, important: true },
  { key: "schedule", title: "Schedule", subtitle: "Not Urgent & Important", urgent: false, important: true },
  { key: "delegate", title: "Delegate", subtitle: "Urgent & Not Important", urgent: true, important: false },
  { key: "delete", title: "Eliminate", subtitle: "Not Urgent & Not Important", urgent: false, important: false },
];

export function EisenhowerMatrix({
  tasks,
  onSelect,
  onChanged,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  async function moveTo(task: Task, urgent: boolean, important: boolean) {
    await api.updateTask(task.id, { isUrgent: urgent, isImportant: important });
    onChanged();
  }

  return (
    <div className="matrix-view">
      <div className="matrix-grid">
        {QUADRANTS.map((q) => {
          const items = tasks.filter((t) => t.isUrgent === q.urgent && t.isImportant === q.important);
          return (
            <div key={q.key} className={`matrix-quadrant quadrant-${q.key}`}>
              <div className="matrix-quadrant-header">
                <strong>{q.title}</strong>
                <span>{q.subtitle}</span>
              </div>
              <ul className="matrix-task-list">
                {items.map((t) => (
                  <li key={t.id} className="matrix-task">
                    <span onClick={() => onSelect(t.id)}>{t.title}</span>
                    <div className="matrix-task-actions">
                      {QUADRANTS.filter((other) => other.key !== q.key).map((other) => (
                        <button
                          key={other.key}
                          title={`Move to ${other.title}`}
                          onClick={() => moveTo(t, other.urgent, other.important)}
                        >
                          {other.title[0]}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
                {items.length === 0 && <li className="matrix-empty">Nothing here</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
