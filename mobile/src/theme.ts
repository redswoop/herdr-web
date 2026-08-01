/** Palette mirrored from web/src/style.css */
export const colors = {
  bg: '#0e0e13',
  surface: '#17171e',
  surface2: '#1f1f29',
  surface3: '#2a2a37',
  hairline: 'rgba(255, 255, 255, 0.07)',
  text: '#e9e9f0',
  sub: '#9a9aab',
  accent: '#7aa2f7',
  accentInk: '#0b0b10',
  blocked: '#f7768e',
  working: '#e0af68',
  done: '#9ece6a',
  idle: '#565f89',
} as const;

export const statusColor = (status: string | undefined): string => {
  switch (status) {
    case 'blocked':
      return colors.blocked;
    case 'working':
      return colors.working;
    case 'done':
      return colors.done;
    case 'idle':
      return colors.idle;
    default:
      return colors.sub;
  }
};

export const radius = { sm: 10, md: 14, lg: 18 } as const;
