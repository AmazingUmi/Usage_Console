import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

export interface HelpSection {
  title: string;
  body: string;
}

interface HelpTipProps {
  /** Plain explanation. Ignored when `sections` is set. */
  text?: string;
  /** Titled paragraphs, for an explanation that should stay scannable. */
  sections?: HelpSection[];
  /** Accessible name of the "?" button; defaults to "Help". */
  label?: string;
}

interface Placement {
  left: number;
  top: number;
  above: boolean;
  width: number;
  maxHeight: number;
}

const MARGIN = 12;
const MAX_WIDTH = 320;
const SECTION_WIDTH = 380;

/**
 * A small "?" that shows an explanation on hover or focus; click pins it open, Esc or a second click closes it.
 * The bubble is rendered at the end of <body> and positioned in viewport coordinates, so card blur layers
 * and scroll containers can neither hide nor clip it.
 */
export const HelpTip: React.FC<HelpTipProps> = ({ text, sections, label }) => {
  const { t } = useI18n();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [pinned, setPinned] = useState(false);
  const structured = Boolean(sections && sections.length > 0);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(structured ? SECTION_WIDTH : MAX_WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, rect.left + rect.width / 2 - width / 2));
    const estimated = structured ? Math.min(440, 28 + (sections?.length ?? 0) * 72) : 140;
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const above = spaceBelow < estimated && spaceAbove > spaceBelow;
    setPlacement({
      left,
      top: above ? rect.top - 8 : rect.bottom + 8,
      above,
      width,
      maxHeight: Math.max(120, (above ? spaceAbove : spaceBelow) - 8),
    });
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
    const onScroll = (event: Event) => {
      if (pop.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, { capture: true });
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
          ref={pop}
          id={id}
          role="tooltip"
          className="help-pop"
          data-above={placement.above || undefined}
          style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={closeSoon}
        >
          {structured ? sections?.map((section) => (
            <p key={section.title}><strong>{section.title}</strong>{section.body}</p>
          )) : text}
        </div>,
        document.body,
      )}
    </>
  );
};
