import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import type { Task } from "../types";

export function CalendarView({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
}) {
  const [cursor, setCursor] = useState(new Date());

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const arr = map.get(t.dueDate) ?? [];
      arr.push(t);
      map.set(t.dueDate, arr);
    }
    return map;
  }, [tasks]);

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <button onClick={() => setCursor(subMonths(cursor, 1))}>‹</button>
        <span>{format(cursor, "MMMM yyyy")}</span>
        <button onClick={() => setCursor(addMonths(cursor, 1))}>›</button>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="calendar-dow">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayTasks = tasksByDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={`calendar-cell ${isSameMonth(day, cursor) ? "" : "outside"} ${
                isToday(day) ? "today" : ""
              }`}
            >
              <div className="calendar-date">{format(day, "d")}</div>
              <div className="calendar-tasks">
                {dayTasks.slice(0, 3).map((t) => (
                  <div
                    key={t.id}
                    className={`calendar-task ${t.isCompleted ? "completed" : ""}`}
                    onClick={() => onSelect(t.id)}
                  >
                    {t.title}
                  </div>
                ))}
                {dayTasks.length > 3 && <div className="calendar-more">+{dayTasks.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
