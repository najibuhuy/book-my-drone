import { progressColor } from "../lib/color";

export default function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" title={`${pct}% complete`}>
      <div
        className="progress-fill"
        style={{ width: `${pct}%`, background: progressColor(pct) }}
      />
      <span className="progress-label">{pct}%</span>
    </div>
  );
}
