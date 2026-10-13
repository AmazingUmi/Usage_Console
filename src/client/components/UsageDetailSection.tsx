import React, { useState } from 'react';
import type { GroupedUsage, TokenUsageRecord } from '../types';
import { formatDateTime, formatTokens, formatUsd } from '../lib/format';

interface UsageDetailSectionProps {
  models: GroupedUsage[];
  clients: GroupedUsage[];
  providers: GroupedUsage[];
  records: TokenUsageRecord[];
}

type Tab = 'software' | 'model' | 'records';

function PercentageCell({ value }: { value: number }) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="pct-cell">
      <div className="breakdown-track"><span style={{ width: `${percent}%` }} /></div>
      <span>{percent}%</span>
    </div>
  );
}

const GroupTable: React.FC<{ items: GroupedUsage[]; nameLabel: string; mono?: boolean }> = ({ items, nameLabel, mono }) => (
  <table className="data-table">
    <thead>
      <tr>
        <th>{nameLabel}</th>
        <th>占比</th>
        <th className="num">Tokens</th>
        <th className="num">输入</th>
        <th className="num">输出</th>
        <th className="num">推理</th>
        <th className="num">请求</th>
        <th className="num">估算费用</th>
      </tr>
    </thead>
    <tbody>
      {items.map((item) => (
        <tr key={item.name}>
          <td className={`strong${mono ? ' mono' : ''}`}>{item.name}</td>
          <td><PercentageCell value={item.percentage} /></td>
          <td className="num strong">{formatTokens(item.totalTokens)}</td>
          <td className="num muted">{formatTokens(item.inputTokens)}</td>
          <td className="num muted">{formatTokens(item.outputTokens)}</td>
          <td className="num muted">{item.reasoningTokens ? formatTokens(item.reasoningTokens) : '—'}</td>
          <td className="num">{(item.requestCount || 0).toLocaleString()}</td>
          <td className="num strong">{formatUsd(item.estimatedCostUsd, 2)}</td>
        </tr>
      ))}
      {items.length === 0 && (
        <tr><td colSpan={8} className="empty">暂无记录</td></tr>
      )}
    </tbody>
  </table>
);

export const UsageDetailSection: React.FC<UsageDetailSectionProps> = ({ models, clients, records }) => {
  const [tab, setTab] = useState<Tab>('software');

  return (
    <section className="section" aria-labelledby="usage-title">
      <div className="section-heading">
        <div>
          <h2 id="usage-title">明细</h2>
          <p className="hint">按软件、模型汇总，或查看最近的每次请求</p>
        </div>
        <div className="segmented" role="group" aria-label="明细视图">
          <button type="button" aria-pressed={tab === 'software'} onClick={() => setTab('software')}>
            软件<span className="count">{clients.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'model'} onClick={() => setTab('model')}>
            模型<span className="count">{models.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'records'} onClick={() => setTab('records')}>
            最近请求<span className="count">{records.length}</span>
          </button>
        </div>
      </div>

      <div className="panel table-scroll">
        {tab === 'software' && <GroupTable items={clients} nameLabel="软件" />}
        {tab === 'model' && <GroupTable items={models} nameLabel="模型" mono />}
        {tab === 'records' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>软件</th>
                <th>模型</th>
                <th className="num">输入</th>
                <th className="num">输出</th>
                <th className="num">缓存命中</th>
                <th className="num">缓存写入</th>
                <th className="num">估算费用</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, idx) => (
                <tr key={record.id || `${record.timestamp}-${record.model}-${idx}`}>
                  <td className="muted mono">{formatDateTime(record.timestamp)}</td>
                  <td><span className="chip">{record.client || 'unknown'}</span></td>
                  <td className="mono" title={record.provider}>{record.model}</td>
                  <td className="num">{formatTokens(record.input)}</td>
                  <td className="num">
                    {formatTokens(record.output)}
                    {record.reasoning ? <span className="hint"> （推理 {formatTokens(record.reasoning)}）</span> : null}
                  </td>
                  <td className="num muted">{record.cacheRead ? formatTokens(record.cacheRead) : '—'}</td>
                  <td className="num muted">{record.cacheWrite ? formatTokens(record.cacheWrite) : '—'}</td>
                  <td className="num strong">{formatUsd(record.estimatedCostUsd, 4)}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={8} className="empty">暂无请求记录</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
