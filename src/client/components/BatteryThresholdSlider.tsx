import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

export interface Thresholds {
  warning: number;
  low: number;
}

interface BatteryThresholdSliderProps {
  value: Thresholds;
  disabled?: boolean;
  /** Called once a drag or key press finishes, with a valid pair (0 ≤ low < warning ≤ 100). */
  onCommit: (next: Thresholds) => void;
}

type Field = keyof Thresholds;

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']);

/**
 * A battery-shaped track split into red / amber / green by two draggable handles
 * (the same idea as codex-switch's battery threshold setting).
 */
export const BatteryThresholdSlider: React.FC<BatteryThresholdSliderProps> = ({ value, disabled, onCommit }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ field: Field; pointerId: number; startX: number; width: number; initial: Thresholds } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (drag.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value.warning, value.low]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Thresholds) => {
    draftRef.current = next;
    setDraft(next);
  };

  const adjust = (field: Field, raw: number) => {
    if (!Number.isFinite(raw)) return;
    const current = draftRef.current;
    const min = field === 'low' ? 0 : current.low + 1;
    const max = field === 'low' ? current.warning - 1 : 100;
    update({ ...current, [field]: Math.round(Math.max(min, Math.min(max, raw))) });
  };

  const commit = () => {
    const next = draftRef.current;
    if (next.warning !== value.warning || next.low !== value.low) onCommit(next);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, field: Field) => {
    if (event.button !== 0 || disabled || drag.current) return;
    const width = trackRef.current?.getBoundingClientRect().width;
    if (!width) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { field, pointerId: event.pointerId, startX: event.clientX, width, initial: { ...draftRef.current } };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    adjust(active.field, active.initial[active.field] + ((event.clientX - active.startX) / active.width) * 100);
  };

  const finish = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) update(active.initial);
    else commit();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, field: Field) => {
    if (!KEYS.has(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey || event.key.startsWith('Page') ? 5 : 1;
    const current = draftRef.current[field];
    const down = event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown';
    adjust(field, event.key === 'Home' ? 0 : event.key === 'End' ? 100 : current + (down ? -step : step));
  };

  return (
    <div className="threshold" data-dragging={dragging || undefined}>
      <div
        ref={trackRef}
        className="threshold-track"
        style={{ '--low': `${draft.low}%`, '--warning-pos': `${draft.warning}%` } as React.CSSProperties}
      >
        {(['low', 'warning'] as const).map((field) => (
          <button
            key={field}
            type="button"
            role="slider"
            className="threshold-handle"
            data-field={field}
            disabled={disabled}
            aria-label={t(`settings.battery.${field}`)}
            aria-valuemin={field === 'low' ? 0 : draft.low + 1}
            aria-valuemax={field === 'low' ? draft.warning - 1 : 100}
            aria-valuenow={draft[field]}
            aria-valuetext={`${draft[field]}%`}
            style={{ left: `${draft[field]}%` }}
            onPointerDown={(event) => onPointerDown(event, field)}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onKeyDown={(event) => onKeyDown(event, field)}
            onKeyUp={(event) => { if (KEYS.has(event.key)) commit(); }}
            onBlur={commit}
          >
            <span className="threshold-value">{draft[field]}%</span>
            <span className="threshold-thumb" aria-hidden="true" />
          </button>
        ))}
      </div>
      <ul className="threshold-legend">
        <li data-tone="low"><i />{t('settings.battery.low')} ≤ {draft.low}%</li>
        <li data-tone="warning"><i />{t('settings.battery.warning')} ≤ {draft.warning}%</li>
        <li data-tone="good"><i />{t('settings.battery.available')} &gt; {draft.warning}%</li>
      </ul>
    </div>
  );
};
