export function computeStreak(
  checkinDates: Set<string>,
  frequency: string,
  daysOfWeek: number[] | null
): number {
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < 3650; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    const scheduled = frequency === "daily" || (daysOfWeek?.includes(dow) ?? false);

    if (scheduled) {
      if (checkinDates.has(iso)) {
        streak++;
      } else if (i > 0) {
        break;
      }
      // i === 0 (today) and not yet checked in: don't break, don't count, keep looking back
    }

    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}
