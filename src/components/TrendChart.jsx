/**
 * TrendChart.jsx
 * Weekly trend line chart using Recharts. Used inside a ChartCard.
 */

import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatWeekLabel, formatWeekRange } from '../utils/weeks';

function WeekTooltip({ active, payload, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: '#FFFFFF',
      border: '0.5px solid #E0DDD6',
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 11,
    }}>
      <div style={{ color: '#8C8A85', marginBottom: 2 }}>{d?.weekRange}</div>
      <div style={{ color: payload[0]?.color, fontWeight: 500, fontFamily: 'DM Mono, monospace' }}>
        {d?.value != null ? valueFormatter(d.value) : '—'}
      </div>
    </div>
  );
}

export function TrendChart({ id, data = [], label, valueFormatter = v => v, color = '#5A7A5C', pending = false, pendingMessage = 'Data pending' }) {
  if (pending) {
    return (
      <div id={id} style={{
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '0.5px dashed #E0DDD6',
        borderRadius: 6,
        color: '#C8BFB0',
        fontSize: 12,
        background: '#FAFAF8',
      }}>
        {pendingMessage}
      </div>
    );
  }

  const chartData = data
    .map(d => ({
      weekLabel: formatWeekLabel(d.weekStart),
      weekRange: formatWeekRange(d.weekStart),
      value: d.value,
    }));

  const hasData = chartData.some(d => d.value != null);

  if (!hasData) {
    return (
      <div id={id} style={{
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '0.5px dashed #E0DDD6',
        borderRadius: 6,
        color: '#C8BFB0',
        fontSize: 12,
        background: '#FAFAF8',
      }}>
        No data yet
      </div>
    );
  }

  return (
    <div id={id}>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="weekLabel"
            tick={{ fontSize: 9, fill: '#8C8A85' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#8C8A85' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => valueFormatter(v)}
            width={48}
          />
          <Tooltip content={<WeekTooltip valueFormatter={valueFormatter} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2, fill: color }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
