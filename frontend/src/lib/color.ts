const PALETTE = [
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
];

/** Deterministically map an arbitrary label (e.g. drone type) to a color. */
export function colorFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/** Color for a progress value: red -> amber -> green. */
export function progressColor(pct: number): string {
  if (pct >= 100) return "#16a34a";
  if (pct >= 66) return "#22c55e";
  if (pct >= 33) return "#f59e0b";
  return "#ef4444";
}
