import React from 'react';

const PATHS = {
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  gauge: <><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2" /><path d="M12 19v2" /><path d="M3 12h2" /><path d="M19 12h2" /><path d="m5.6 5.6 1.4 1.4" /><path d="m17 17 1.4 1.4" /><path d="m18.4 5.6-1.4 1.4" /><path d="M7 17l-1.4 1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></>,
  edit: <><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 3 3" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  settings: <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export const Icon: React.FC<{ name: IconName; size?: number; className?: string }> = ({ name, size = 16, className }) => (
  <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {PATHS[name]}
  </svg>
);
