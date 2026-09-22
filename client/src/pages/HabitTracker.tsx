import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { api } from "../api";
import type { Habit } from "../types";

const DAYS_SHOWN = 14;
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#e11d48", "#8b5cf6", "#06b6d4"];

function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => format(subDays(new Date(), n - 1 - i), "yyyy-MM-dd"));
}

export function HabitTracker() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  function refresh() {
    api.getHabits(DAYS_SHOWN + 21).then(({ habits }) => setHabits(habits));
  }

  useEffect(refresh, []);

  const days = lastNDays(DAYS_SHOWN);
  const today = format(new Date(), "yyyy-MM-dd");

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setShowAdd(false);
    const color = COLORS[habits.length % COLORS.length];
    await api.createHabit({ name, color });
    refresh();
  }

  async function toggleDay(habit: Habit, date: string) {
    if (habit.checkins.includes(date)) {
      await api.uncheckinHabit(habit.id, date);
    } else {
      await api.checkinHabit(habit.id, date);
    }
    refresh();
  }

  async function handleDelete(habit: Habit) {
    if (!confirm(`Delete habit "${habit.name}"?`)) return;
    await api.deleteHabit(habit.id);
    refresh();
  }

  return (
    <div className="habit-tracker">
      <div className="habit-header-row">
        <button className="link-btn" onClick={() => setShowAdd((s) => !s)}>
          + New habit
        </button>
      </div>
      {showAdd && (
        <div className="add-list-row">
          <input
            autoFocus
            placeholder="Habit name (e.g. Meditate)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button onClick={handleAdd}>Add</button>
        </div>
      )}

      {habits.length === 0 && <div className="empty-state">No habits yet. Add one to start tracking.</div>}

      {habits.length > 0 && (
        <table className="habit-table">
          <thead>
            <tr>
              <th className="habit-name-col">Habit</th>
              {days.map((d) => (
                <th key={d} className={`habit-day-col ${d === today ? "today" : ""}`}>
                  {format(new Date(d + "T00:00:00Z"), "d")}
                </th>
              ))}
              <th className="habit-streak-col">Streak</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {habits.map((habit) => (
              <tr key={habit.id}>
                <td className="habit-name-col">
                  <span className="dot" style={{ background: habit.color }} />
                  {habit.name}
                </td>
                {days.map((d) => {
                  const done = habit.checkins.includes(d);
                  return (
                    <td key={d} className={`habit-day-col ${d === today ? "today" : ""}`}>
                      <button
                        className={`habit-cell ${done ? "done" : ""}`}
                        style={done ? { background: habit.color, borderColor: habit.color } : undefined}
                        onClick={() => toggleDay(habit, d)}
                        title={d}
                      />
                    </td>
                  );
                })}
                <td className="habit-streak-col">
                  {habit.streak > 0 ? `🔥 ${habit.streak}` : "—"}
                </td>
                <td>
                  <button className="link-btn danger small" onClick={() => handleDelete(habit)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
