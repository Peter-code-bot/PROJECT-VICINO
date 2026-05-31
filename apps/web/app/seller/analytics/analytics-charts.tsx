"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AnalyticsChartsProps {
  dailyData: Array<{ date: string; ventas: number }>;
  topProducts: Array<{ name: string; ventas: number }>;
}

export function AnalyticsCharts({
  dailyData,
  topProducts,
}: AnalyticsChartsProps) {
  return (
    <div className="space-y-8">
      {/* Daily sales */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Ventas por día (últimos 30 días)</h2>
        {dailyData.length > 0 ? (
          <div className="h-64 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={(v) => `Fecha: ${String(v)}`}
                />
                <Line
                  type="monotone"
                  dataKey="ventas"
                  stroke="var(--brand-base)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sin ventas en los últimos 30 días
          </p>
        )}
      </div>

      {/* Top products */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Productos más vendidos</h2>
        {topProducts.length > 0 ? (
          <div className="h-64 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  width={120}
                />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="ventas" fill="var(--brand-base)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sin datos de productos
          </p>
        )}
      </div>
    </div>
  );
}
