import React, { useEffect, useState } from 'react';
import type { ConnectionState } from '../types';
import { useI18n } from '../i18n';
import type { ThemePref } from '../theme';
import { useTheme } from '../theme';
import { Icon } from './Icon';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  connectionState?: ConnectionState;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

const NAV_ITEMS = [
  { id: 'quota-title', key: 'nav.quota' },
  { id: 'overview-title', key: 'nav.overview' },
  { id: 'usage-title', key: 'nav.detail' },
  { id: 'settings-title', key: 'nav.settings' },
] as const;

/** One button cycles system -> light -> dark; the icon shows the current choice. */
const THEME_ICON: Record<ThemePref, 'monitor' | 'sun' | 'moon'> = { system: 'monitor', light: 'sun', dark: 'moon' };
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

/** Highlights the nav item of the section currently under the top of the viewport. */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(NAV_ITEMS[0].id);

  useEffect(() => {
    const update = () => {
      const line = window.innerHeight * 0.3;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current: string = NAV_ITEMS[0].id;
      for (const { id } of NAV_ITEMS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(atBottom ? NAV_ITEMS[NAV_ITEMS.length - 1].id : current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return active;
}

export const Header: React.FC<HeaderProps> = ({
  onRefresh,
  isRefreshing,
  lastUpdated,
  connectionState = 'connecting',
  settingsOpen,
  onToggleSettings,
}) => {
  const active = useActiveSection();
  const { t, locale } = useI18n();
  const { pref, setPref } = useTheme();
  const statusLabel = t(`conn.${connectionState}`);
  const statusTitle = lastUpdated
    ? `${statusLabel} · ${t('header.updated', { time: new Date(lastUpdated).toLocaleTimeString(locale) })}`
    : statusLabel;

  return (
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#main" aria-label={t('header.home')}>
          <span className="brand-mark" aria-hidden="true"><Icon name="gauge" size={16} /></span>
          Usage Console
        </a>
        <nav className="main-nav" aria-label={t('nav.aria')}>
          {NAV_ITEMS.map(({ id, key }) => (
            id === 'settings-title' ? (
              <button
                key={id}
                type="button"
                aria-expanded={settingsOpen}
                aria-controls="settings-panel"
                aria-current={active === id ? 'location' : undefined}
                onClick={onToggleSettings}
              >
                {t(key)}
              </button>
            ) : (
              <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{t(key)}</a>
            )
          ))}
        </nav>
        <div className="header-meta">
          <span className="header-circle" role="status" aria-label={statusLabel} title={statusTitle}>
            <i className="connection-status" data-state={connectionState} />
          </span>
          <button
            type="button"
            className="header-circle"
            aria-label={t('theme.toggle', { mode: t(`theme.${pref}`) })}
            title={t('theme.toggle', { mode: t(`theme.${pref}`) })}
            onClick={() => setPref(THEME_NEXT[pref])}
          >
            <Icon name={THEME_ICON[pref]} size={16} />
          </button>
          <button
            type="button"
            className="header-circle"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            aria-label={isRefreshing ? t('header.refreshing') : t('header.refresh')}
            title={isRefreshing ? t('header.refreshing') : t('header.refresh')}
          >
            <Icon name="refresh" size={16} className={isRefreshing ? 'is-spinning' : undefined} />
          </button>
        </div>
      </div>
    </header>
  );
};
