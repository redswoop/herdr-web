import { md } from '../../md';
import type { SceneCard } from '../types';

/** `summary`: a markdown blurb with an accent tone. */
export function SummaryCard({ card }: { card: SceneCard }) {
  const body = typeof card.props.body === 'string' ? card.props.body : '';
  const tone = typeof card.props.tone === 'string' ? card.props.tone : 'info';
  return (
    <div className={`scene-summary tone-${tone}`} dangerouslySetInnerHTML={{ __html: md(body) }} />
  );
}
