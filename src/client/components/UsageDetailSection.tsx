import React, { useState } from 'react';
import type { GroupedUsage, TokenUsageRecord } from '../types';

interface UsageDetailSectionProps {
  models: GroupedUsage[];
  clients: GroupedUsage[];
  providers: GroupedUsage[];
  records: TokenUsageRecord[];
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export const UsageDetailSection: React.FC<UsageDetailSectionProps> = ({
  models,
  clients,
  providers,
  records,
}) => {
  const [activeTab, setActiveTab] = useState<'software' | 'model' | 'records'>('software');

  return (
    <section id="usage-title" className="section usage-section" aria-labelledby="usage-heading">
      <div className="section-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <h2 id="usage-heading">用量分析与明细</h2>
        </div>

        <div className="comparison-tabs">
          <button
            type="button"
            className={`comparison-tab-btn ${activeTab === 'software' ? 'active' : ''}`}
            onClick={() => setActiveTab('software')}
          >
            按软件明细 ({clients.length})
          </button>
          <button
            type="button"
            className={`comparison-tab-btn ${activeTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveTab('model')}
          >
            按模型明细 ({models.length})
          </button>
          <button
            type="button"
            className={`comparison-tab-btn ${activeTab === 'records' ? 'active' : ''}`}
            onClick={() => setActiveTab('records')}
          >
            实时调用流水 ({records.length})
          </button>
        </div>
      </div>

      <div className="panel models-panel" style={{ padding: '20px 24px' }}>
        {activeTab === 'software' && (
          <div>
            <div className="subsection-heading" style={{ marginBottom: '12px' }}>
              <div className="title-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3>各软件客户端 Token 与开销汇总</h3>
                <details className="info-help">
                  <summary aria-label="软件统计说明">?</summary>
                  <div className="help-content">
                    <strong>软件客户端统计</strong>
                    <p>自动识别 Codex (OpenAI)、Pi Coding Agent、Grok Build 等本地工具的会话消耗。</p>
                  </div>
                </details>
              </div>
            </div>

            <div className="table-scroll">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>客户端工具</th>
                    <th>占比</th>
                    <th>总 Tokens</th>
                    <th>输入 / 输出</th>
                    <th>推理 Tokens</th>
                    <th>调用轮次</th>
                    <th style={{ textAlign: 'right' }}>估算费用 (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.name}>
                      <td style={{ fontWeight: 600 }}>
                        <span className="client-badge">{c.name}</span>
                      </td>
                      <td style={{ minWidth: '120px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '5px', background: 'var(--track)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${c.percentage}%`, background: 'var(--accent)' }} />
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', width: '36px' }}>{c.percentage}%</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(c.totalTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{formatTokens(c.inputTokens)} / {formatTokens(c.outputTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{c.reasoningTokens ? formatTokens(c.reasoningTokens) : '—'}</td>
                      <td>{c.requestCount.toLocaleString()} 次</td>
                      <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--accent)' }}>
                        ${c.estimatedCostUsd.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                  {clients.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                        暂无软件记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'model' && (
          <div>
            <div className="subsection-heading" style={{ marginBottom: '12px' }}>
              <div className="title-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3>各模型详细使用记录</h3>
                <details className="info-help">
                  <summary aria-label="模型统计说明">?</summary>
                  <div className="help-content">
                    <strong>模型统计说明</strong>
                    <p>按 LLM 模型分组统计 Token 消耗与公开 API 定价估算。</p>
                  </div>
                </details>
              </div>
            </div>

            <div className="table-scroll">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>模型名称</th>
                    <th>占比</th>
                    <th>总 Tokens</th>
                    <th>输入 / 输出</th>
                    <th>推理 Tokens</th>
                    <th>调用轮次</th>
                    <th style={{ textAlign: 'right' }}>估算费用 (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.name}>
                      <td style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{m.name}</td>
                      <td style={{ minWidth: '120px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '5px', background: 'var(--track)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${m.percentage}%`, background: 'var(--accent)' }} />
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', width: '36px' }}>{m.percentage}%</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(m.totalTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{formatTokens(m.inputTokens)} / {formatTokens(m.outputTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{m.reasoningTokens ? formatTokens(m.reasoningTokens) : '—'}</td>
                      <td>{m.requestCount.toLocaleString()} 次</td>
                      <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--accent)' }}>
                        ${m.estimatedCostUsd.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                  {models.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                        暂无模型记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div>
            <div className="subsection-heading" style={{ marginBottom: '12px' }}>
              <div className="title-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3>实时调用流水</h3>
                <details className="info-help">
                  <summary aria-label="流水说明">?</summary>
                  <div className="help-content">
                    <strong>调用流水</strong>
                    <p>展示各客户端近期的每一次独立请求调用与明细。</p>
                  </div>
                </details>
              </div>
            </div>

            <div className="table-scroll">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>客户端</th>
                    <th>渠道</th>
                    <th>模型</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>缓存命中</th>
                    <th>总计</th>
                    <th style={{ textAlign: 'right' }}>费用估算</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                        {formatDateTime(r.timestamp)}
                      </td>
                      <td>
                        <span className="client-badge">{r.client || 'unknown'}</span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>{r.provider}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 550 }}>{r.model}</td>
                      <td>{formatTokens(r.input)}</td>
                      <td>
                        {formatTokens(r.output)}
                        {r.reasoning ? <span style={{ color: 'var(--chart-secondary)', fontSize: '10.5px', marginLeft: '4px' }}>({formatTokens(r.reasoning)})</span> : null}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{r.cacheRead ? formatTokens(r.cacheRead) : '—'}</td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(r.totalTokens)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                        ${(r.estimatedCostUsd || 0).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                        暂无流水记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
