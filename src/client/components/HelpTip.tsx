import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

interface HelpTipProps {
  /** The explanation shown in the bubble. */
  text: string;
  /** Accessible name of the "?" button; defaults to "Help". */
  label?: string;
}

interface Placement {
  left: number;
  top: number;
  above: boolean;
  width: number;
}

const MARGIN = 12;
const MAX_WIDTH = 320;

/**
 * A small "?" that shows an explanation on hover or focus; click pins it open, Esc or a second click closes it.
 * The bubble is rendered at the end of <body> and positioned in viewport coordinates, so card blur layers
 * and scroll containers can neither hide nor clip it.
 */
export const HelpTip: React.FC<HelpTipProps> = ({ text, label }) => {
  const { t } = useI18n();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [pinned, setPinned] = useState(false);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(MAX_WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, rect.left + rect.width / 2 - width / 2));
    const above = rect.bottom + 140 > window.innerHeight && rect.top > 140;
    setPlacement({ left, top: above ? rect.top - 8 : rect.bottom + 8, above, width });
  };

  const close = () => {
    window.clearTimeout(closeTimer.current);
    setPlacement(null);
    setPinned(false);
  };

  const closeSoon = () => {
    if (pinned) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(close, 120);
  };

  useEffect(() => {
    if (!placement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // The anchor moves on scroll and resize; closing is simpler and less jumpy than chasing it.
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [placement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help-tip"
        aria-label={label ?? t('help.label')}
        aria-describedby={placement ? id : undefined}
        aria-expanded={Boolean(placement)}
        onMouseEnter={open}
        onMouseLeave={closeSoon}
        onFocus={open}
        onBlur={close}
        onClick={() => (pinned ? close() : (open(), setPinned(true)))}
      >
        ?
      </button>
      {placement && createPortal(
        <div
          id={id}
          role="tooltip"
          className="help-pop"
          data-above={placement.above || undefined}
          style={{ left: placement.left, top: placement.top, width: placement.width }}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={closeSoon}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
};
