/* Claude's permission modes as the UI names them — shared by the web header
   chip, the Capra header chip and both launchers. */
import type { ModeState, PermissionMode } from './types';

export const MODE_LABEL: Record<ModeState, string> = {
  default: 'manual',
  acceptEdits: 'edits',
  plan: 'plan',
  auto: 'auto',
  bypassPermissions: 'bypass',
  unknown: '—',
};

export const MODE_DESC: Record<PermissionMode, string> = {
  default: 'approve every tool use',
  acceptEdits: 'file edits auto-approved',
  plan: 'read-only until you approve a plan',
  auto: 'runs tools without asking',
  bypassPermissions: 'no permission checks at all',
};

export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];

/** kinds whose live permission mode the server can read and set */
export const LIVE_MODE_KINDS = ['claude'];
