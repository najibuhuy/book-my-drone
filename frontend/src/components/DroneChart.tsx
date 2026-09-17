import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DroneTypeStat } from "../types";
import { colorFor } from "../lib/color";

export default function DroneChart({ data }: { data: DroneTypeStat[] }) {
  if (data.length === 0) {
    return <p className="detail-empty">No booking data yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis type="number" allowDecimals={false} fontSize={12} />
        <YAxis
          type="category"
          dataKey="drone_type"
          width={130}
          fontSize={12}
          tickLine={false}
        />
        <Tooltip
          formatter={(v: number) => [`${v} drones`, "Total"]}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Bar dataKey="total_drones" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.drone_type} fill={colorFor(d.drone_type)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
