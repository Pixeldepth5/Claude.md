export type RecurringFreq = "daily" | "weekly" | "monthly" | "yearly";

/** Computes the next due date (ISO date string, YYYY-MM-DD) for a recurring task. */
export function nextDueDate(currentDueDate: string, freq: RecurringFreq, interval: number): string {
  const [y, m, d] = currentDueDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  switch (freq) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + interval);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + interval * 7);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + interval);
      break;
    case "yearly":
      date.setUTCFullYear(date.getUTCFullYear() + interval);
      break;
  }
  return date.toISOString().slice(0, 10);
}
