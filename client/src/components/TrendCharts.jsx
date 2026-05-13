import {
  LineChart, Line, AreaChart, Area,
  XAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';

function formatDate(dateStr) {
  try { return format(new Date(dateStr), 'MMM d'); } catch { return dateStr; }
}

export default function TrendCharts({ sparklineData = [], areaData = [] }) {
  const spark = sparklineData.slice(-7);
  const area  = areaData.slice(-30);

  return (
    <>
      <style>{`
        .trend-section { display: flex; flex-direction: column; gap: 12px; }
        .trend-label {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 4px;
        }
      `}</style>
      <div className="trend-section">
        <div>
          <div className="trend-label">7-day sparkline</div>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={spark} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Line
                type="monotone"
                dataKey="cases"
                stroke="var(--accent-red)"
                strokeWidth={2}
                dot={{ fill: 'var(--accent-red)', r: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="trend-label">30-day trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={area} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="redGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-red)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--accent-red)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                }}
                labelFormatter={formatDate}
              />
              <Area
                type="monotone"
                dataKey="cases"
                stroke="var(--accent-red)"
                strokeWidth={2}
                fill="url(#redGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
