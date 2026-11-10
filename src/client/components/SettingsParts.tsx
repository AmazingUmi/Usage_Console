import React from 'react';
import { HelpTip } from './HelpTip';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/*
 * Building blocks for the settings panes, modelled on grouped system settings: a pane head (tinted glyph, title,
 * one-line description, actions), then inset glass groups of rows. A row is label-left / control-right, or stacked
 * when the control needs the full width (paths, sliders).
 */

export const SettingsGlyph: React.FC<{ icon: IconName; size?: 'sm' | 'lg' }> = ({ icon, size = 'sm' }) => (
  <span className="settings-glyph" data-size={size} aria-hidden="true">
    <Icon name={icon} size={size === 'lg' ? 18 : 14} />
  </span>
);

export const PaneHead: React.FC<{
  icon: IconName;
  title: string;
  titleId: string;
  description?: string;
  children?: React.ReactNode;
}> = ({ icon, title, titleId, description, children }) => (
  <header className="pane-head">
    <SettingsGlyph icon={icon} size="lg" />
    <div className="pane-title">
      <h3 id={titleId}>{title}</h3>
      {description && <p>{description}</p>}
    </div>
    {children && <div className="pane-actions">{children}</div>}
  </header>
);

export const ListGroup: React.FC<{
  label?: React.ReactNode;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, aside, footer, children }) => (
  <div className="list-block">
    {(label || aside) && (
      <div className="list-label">
        <span>{label}</span>
        {aside}
      </div>
    )}
    <div className="list-group">{children}</div>
    {footer && <p className="list-footer">{footer}</p>}
  </div>
);

export const ListRow: React.FC<{
  title: React.ReactNode;
  help?: string;
  sub?: React.ReactNode;
  lead?: React.ReactNode;
  /** Sits at the end of the title line (status pills, small resets). */
  aside?: React.ReactNode;
  stacked?: boolean;
  htmlFor?: string;
  children?: React.ReactNode;
}> = ({ title, help, sub, lead, aside, stacked, htmlFor, children }) => {
  const Title = htmlFor ? 'label' : 'span';
  return (
    <div className="list-row" data-stacked={stacked || undefined}>
      {lead}
      <div className="row-text">
        <div className="row-head">
          <span className="row-title">
            <Title htmlFor={htmlFor}>{title}</Title>
            {help && <HelpTip text={help} />}
          </span>
          {aside && <span className="row-aside">{aside}</span>}
        </div>
        {sub && <span className="row-sub">{sub}</span>}
      </div>
      {children !== undefined && <div className="row-control">{children}</div>}
    </div>
  );
};
