/** Double-chevron icon for collapse/expand toggles. */
export function Chevrons({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dir === 'left' ? <path d="M18 7l-5 5 5 5M11 7l-5 5 5 5" /> : <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />}
    </svg>
  );
}
