import React, { useEffect, useState } from 'react';
import type { ConnectionState } from '../types';
import { Icon } from './Icon';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  connectionState?: ConnectionState;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  connecting: '正在连接本地服务',
  connected: '已连接本地服务',
  offline: '本地服务连接失败',
};

const NAV_ITEMS = [
  { id: 'quota-title', label: '额度' },
  { id: 'overview-title', label: '用量' },
  { id: 'usage-title', label: '明细' },
  { id: 'settings-title', label: '设置' },
] as const;

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

  return (
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#main" aria-label="Usage Console 首页">
          <span className="brand-mark" aria-hidden="true"><Icon name="gauge" size={16} /></span>
          Usage Console
        </a>
        <nav className="main-nav" aria-label="页面导航">
          {NAV_ITEMS.map(({ id, label }) => (
            id === 'settings-title' ? (
              <button
                key={id}
                type="button"
                aria-expanded={settingsOpen}
                aria-controls="settings-panel"
                aria-current={active === id ? 'location' : undefined}
                onClick={onToggleSettings}
              >
                {label}
              </button>
            ) : (
              <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>
            )
          ))}
        </nav>
        <div className="header-meta">
          <span
            className="connection-status"
            data-state={connectionState}
            role="status"
            aria-label={STATUS_LABEL[connectionState]}
            title={STATUS_LABEL[connectionState]}
          />
          {lastUpdated && <span className="updated">更新于 {new Date(lastUpdated).toLocaleTimeString()}</span>}
          <button
            type="button"
            className="btn"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
          >
            <Icon name="refresh" size={14} className={isRefreshing ? 'is-spinning' : undefined} />
            {isRefreshing ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>
    </header>
  );
};
