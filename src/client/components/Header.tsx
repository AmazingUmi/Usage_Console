import React from 'react';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onRefresh, isRefreshing }) => {
  return (
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#main" aria-label="Usage Console 首页">
          <span className="brand-mark" aria-hidden="true">π</span>
          <span>Usage Console</span>
        </a>
        <nav className="main-nav" aria-label="页面导航">
          <a href="#quota-title">额度</a>
          <a href="#overview-title">趋势</a>
          <a href="#usage-title">用量</a>
        </nav>
        <button
          id="refresh"
          className="button-primary"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <span aria-hidden="true" style={{ display: 'inline-block', transform: isRefreshing ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>
            ↻
          </span>{' '}
          {isRefreshing ? '正在刷新…' : '刷新额度'}
        </button>
        <span
          id="connection-status"
          className="connection-status"
          data-state="connected"
          role="status"
          aria-label="已连接"
          title="已连接本地数据源"
        ></span>
      </div>
    </header>
  );
};
