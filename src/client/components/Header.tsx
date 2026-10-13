import React, { useEffect, useState } from 'react';
import type { ConnectionState } from '../types';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  connectionState?: ConnectionState;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  connecting: '正在连接本地数据源',
  connected: '已连接本地数据源',
  offline: '数据源连接失败',
};

const NAV_ITEMS = [
  { id: 'quota-title', label: '额度' },
  { id: 'overview-title', label: '趋势' },
  { id: 'usage-title', label: '用量' },
  { id: 'settings-title', label: '设置' },
] as const;

/** Highlights the nav pill of the section currently under the top of the viewport. */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(NAV_ITEMS[0].id);

  useEffect(() => {
    const update = () => {
      const line = window.innerHeight * 0.32;
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
  const statusTitle = lastUpdated
    ? `${STATUS_LABEL[connectionState]} · 更新于 ${new Date(lastUpdated).toLocaleTimeString()}`
    : STATUS_LABEL[connectionState];

  return (
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#main" aria-label="Usage Console 首页">
          <span className="brand-mark" aria-hidden="true">π</span>
          <span className="brand-name">Usage Console</span>
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
              <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>
                {label}
              </a>
            )
          ))}
        </nav>
        <button
          id="refresh"
          className="button-primary"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
        >
          <svg
            className={`icon-refresh${isRefreshing ? ' is-spinning' : ''}`}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path d="M13 8a5 5 0 1 1-1.6-3.7" />
            <path d="M12.6 2v2.6H10" />
          </svg>
          <span className="refresh-label">{isRefreshing ? '正在刷新…' : '刷新额度'}</span>
        </button>
        <span
          id="connection-status"
          className="connection-status"
          data-state={connectionState === 'offline' ? 'offline' : connectionState === 'connecting' ? 'connecting' : 'connected'}
          role="status"
          aria-label={STATUS_LABEL[connectionState]}
          title={statusTitle}
        ></span>
      </div>
    </header>
  );
};
