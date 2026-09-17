import { useEffect, useState } from 'react';
import { useRelayFeed } from './useRelayFeed.js';
import { PipelineLanes } from './panels/PipelineLanes.js';
import { WaitingOnYou } from './panels/WaitingOnYou.js';
import { LiveSessions } from './panels/LiveSessions.js';
import { MetricsStrip } from './panels/MetricsStrip.js';
import { IncidentStrip } from './panels/IncidentStrip.js';
import { Spotlight } from './Spotlight.js';
import type { FlowMetrics } from './types.js';

const EMPTY_METRICS: FlowMetrics = { gateLatencyS: {}, stageCycleTimeS: {}, overrideCount: 0, firstPassRate: NaN };

export default function App() {
  const feed = useRelayFeed();
  const [metrics, setMetrics] = useState<FlowMetrics>(EMPTY_METRICS);

  useEffect(() => {
    const refresh = () => fetch('/api/metrics').then((res) => res.json()).then(setMetrics);
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <IncidentStrip items={feed.items} />
      <Spotlight items={feed.items}>{(shown) => <PipelineLanes items={shown} />}</Spotlight>
      <LiveSessions activity={feed.activity} />
      <WaitingOnYou items={feed.items} />
      <MetricsStrip metrics={metrics} />
    </div>
  );
}
