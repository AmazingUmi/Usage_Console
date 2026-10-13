import React from 'react';
import type { ConnectionState } from '../types';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  connectionState?: ConnectionState;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  connecting: '正在连接本地数据源',
  connected: '已连接本地数据源',
  offline: '数据源连接失败',
};

export const Header: React.FC<HeaderProps> = ({
  onRefresh,
  isRefreshing,
  lastUpdated,
  connectionState = 'connecting',
}) => {
  const statusTitle = lastUpdated
    ? `${STATUS_LABEL[connectionState]} · 更新于 ${new Date(lastUpdated).toLocaleTimeString()}`
    : STATUS_LABEL[connectionState];

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
          data-state={connectionState === 'offline' ? 'offline' : 'connected'}
          role="status"
          aria-label={STATUS_LABEL[connectionState]}
          title={statusTitle}
        ></span>
      </div>
    </header>
  );
};
