import type { ComponentType } from 'react';
import type { ActionResult, SceneCard } from '../types';
import { CommandWatch } from './CommandWatch';
import { ServiceControl } from './ServiceControl';
import { SummaryCard } from './SummaryCard';

export interface CardProps {
  card: SceneCard;
  /** press a button on this card (plugins with server-side actions) */
  act: (id: string, action: string) => Promise<ActionResult>;
}

export type CardComponent = ComponentType<CardProps>;

/** Client-side plugin registry. Keys match lib/scene.js PLUGINS. */
export const PLUGINS: Record<string, CardComponent> = {
  summary: SummaryCard,
  'command-watch': CommandWatch,
  'service-control': ServiceControl,
};

/** A plugin the server knows but this bundle doesn't — show what we got. */
export function UnknownCard({ card }: CardProps) {
  return (
    <pre className="scene-text">
      {`no renderer for "${card.plugin}"\n`}
      {JSON.stringify({ props: card.props, data: card.data }, null, 1)}
    </pre>
  );
}
