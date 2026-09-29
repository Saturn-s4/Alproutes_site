type P = { size?: number };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const LogoMark = ({ size = 26 }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <path d="M2 22 L10 8 L14 14 L17 10 L24 22 Z" strokeWidth="2" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }} />
  </svg>
);
export const SearchIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
);
export const PlusIcon = ({ size = 16 }: P) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>
);
export const SunIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const MoonIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
);
export const UserIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const DownloadIcon = ({ size = 16 }: P) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
);
export const UploadIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
);
export const BookmarkIcon = ({ size = 18, filled = false }: P & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}><path d="M6 3h12v18l-6-4-6 4z" /></svg>
);
export const LayersIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>
);
export const CloseIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const ExpandIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
);

/** Mountain silhouette placeholder used where a photo will go. */
export function Ridge({ variant = 0 }: { variant?: number }) {
  const ridges = [
    'M0 150 L60 80 L110 110 L170 30 L220 90 L300 60 L300 150 Z',
    'M0 150 L40 110 L120 50 L170 90 L240 40 L300 100 L300 150 Z',
    'M0 150 L80 60 L130 100 L190 70 L250 20 L300 70 L300 150 Z',
  ];
  return (
    <svg viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true">
      <path d={ridges[variant % ridges.length]} style={{ fill: 'var(--photo2)' }} />
    </svg>
  );
}
