export type Stage = 'intake' | 'plan' | 'design' | 'build' | 'done';

export interface ItemProjection {
  id: string;
  lane: string;
  stage: Stage;
  blockedBy: string[];
}

export interface TransitionEvent {
  type: 'transition';
  id: string;
  from: string;
  to: string;
}

export interface FlowMetrics {
  gateLatencyS: Partial<Record<Stage, { count: number; avgS: number }>>;
  stageCycleTimeS: Partial<Record<Stage, { count: number; avgS: number }>>;
  overrideCount: number;
  firstPassRate: number;
}
