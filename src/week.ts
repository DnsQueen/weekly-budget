// ISO week helpers. Weeks are strings like "2026-W45".

export function isoWeek(date: Date): string {
  // Work in UTC so the result does not depend on the server's timezone.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // ISO day of week: Monday = 1 .. Sunday = 7.
  const day = d.getUTCDay() || 7;
  // Move to the Thursday of this week; the ISO year is the Thursday's year.
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function isValidWeek(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(value)
  );
}
