// Small inline icons (no icon font, no network). Every state shows icon + label, never color alone.
type Name =
  | 'drop'
  | 'pump'
  | 'check'
  | 'alert'
  | 'warn'
  | 'wifi'
  | 'wifiOff'
  | 'pause'
  | 'play'
  | 'reset'
  | 'tour'
  | 'gear'
  | 'sun'
  | 'moon'
  | 'screen'
  | 'expand'
  | 'leaf'
  | 'clock'
  | 'info'
  | 'flood'
  | 'off';

const P: Record<Name, string> = {
  drop: 'M12 2.5c4 5.2 7 9.3 7 12.8A7 7 0 0 1 5 15.3c0-3.5 3-7.6 7-12.8z',
  pump: 'M4 10h9v8H4zM13 13h4V7h3M8.5 10V6M6 6h5',
  check: 'M4 12.5l5 5L20 6.5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  warn: 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM12 7.5v6M12 16.5v.5',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0M12 19.5v.5',
  wifiOff: 'M3 3l18 18M8.7 16a5 5 0 0 1 6.6 0M12 19.5v.5M5.5 12.5a9.5 9.5 0 0 1 4-2.3M2.5 9a14 14 0 0 1 5-3',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5l12 7.5-12 7.5z',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5',
  tour: 'M4 6h12M4 12h16M4 18h9M19 15l3 3-3 3',
  gear: 'M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  sun: 'M12 7.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9zM12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  leaf: 'M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l7-7',
  clock: 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM12 7v5l3.5 2',
  info: 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  flood: 'M2 15c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 0M2 19.5c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 0M12 2.5c2.5 3.2 4 5.5 4 7.3a4 4 0 0 1-8 0c0-1.8 1.5-4.1 4-7.3z',
  off: 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM5.6 5.6l12.8 12.8',
};

export function Icon({ name, size = '1em', title }: { name: Name; size?: string; title?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}
