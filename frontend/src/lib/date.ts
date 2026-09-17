// All calendar math is done on local dates using YYYY-MM-DD strings so it
// stays timezone-agnostic (no accidental day shifts from UTC parsing).

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISO(a) === toISO(b);
}

/**
 * Return the 6x7 grid of days (42 cells) that covers the given month,
 * padded with trailing/leading days from adjacent months. Week starts Sunday.
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function prettyDate(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** True if `iso` falls within [start, end] inclusive. */
export function dateInRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}
