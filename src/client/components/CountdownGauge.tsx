import React, { useId } from 'react';


interface CountdownGaugeProps {
  /** Compact centre label, such as `2m` or `刚刚`. */
  label: string;
  /** Remaining share of the fresh window. Null draws a quiet full ring. */
  progress: number | null;
  title: string;
  tone?: 'fresh' | 'aging' | 'old';
}

/**
 * Glass reading-age countdown beside the card's edit button.
 * The arc drains clockwise from 12 o'clock; the bead sits on the moving end.
 */
export const CountdownGauge: React.FC<CountdownGaugeProps> = ({ label, progress, title, tone = 'fresh' }) => {
  const gradId = `gg-${useId().replace(/:/g, '')}`;
  const known = progress != null;
  const shown = known ? Math.min(1, Math.max(0, progress)) : 1;
  // A nearly closed dash with round caps leaves a notch where the ends fail to meet.
  const closed = shown >= 0.985;
  const mode = !known ? 'open' : shown <= 0 ? 'due' : 'countdown';
  const wide = label.length > 2 || [...label].some((char) => char.charCodeAt(0) > 127);

  return (
    <span
      className="countdown-gauge"
      data-mode={mode}
      data-tone={tone}
      role="img"
      aria-label={`${label}, ${title}`}
      title={title}
    >
      <span className="halo" />
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop className="s1" offset="0" stopColor="#8ef0c0" />
            <stop className="s2" offset="1" stopColor="#14b86a" />
          </linearGradient>
        </defs>
        <g transform="rotate(-90 30 30)">
          <circle className="tr" cx="30" cy="30" r="24.5" />
          <circle
            className="arc"
            cx="30"
            cy="30"
            r="24.5"
            pathLength={100}
            stroke={`url(#${gradId})`}
            strokeDasharray={closed ? undefined : `${shown * 100 + 2} 100`}
          />
        </g>
        {!closed && (
          <g className="head" transform={`rotate(${shown * 360} 30 30)`}>
            <circle className="bead" cx="30" cy="5.5" r="3.2" fill={`url(#${gradId})`} />
            <circle className="bead2" cx="29.2" cy="4.6" r="1" />
          </g>
        )}
      </svg>
      <span className="disc" />
      <span className="num" data-long={wide ? '' : undefined}>{label}</span>
    </span>
  );
};
