import React, { useState } from 'react';
import type { GroupedUsage, TokenUsageRecord } from '../types';
import { formatDateTime, formatTokens, formatUsd } from '../lib/format';

interface UsageDetailSectionProps {
  models: GroupedUsage[];
  clients: GroupedUsage[];
  providers: GroupedUsage[];
  records: TokenUsageRecord[];
}

function PercentageCell({ value }: { value: number }) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '5px', background: 'var(--track)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${percent}%`, background: 'var(--accent)' }} />
      </div>
      <span style={{ fontSize: '11px', color: 'var(--muted)', width: '36px' }}>{percent}%</span>
    </div>
  );
}

export const UsageDetailSection: React.FC<UsageDetailSectionProps> = ({
  models,
  clients,
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
                    <p>自动识别 Codex、Pi、Claude Code 对话、Grok Build 等本地工具的会话消耗。</p>
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
                  {clients.map((item) => (
                    <tr key={item.name}>
                      <td style={{ fontWeight: 600 }}>
                        <span className="client-badge">{item.name}</span>
                      </td>
                      <td style={{ minWidth: '120px' }}>
                        <PercentageCell value={item.percentage} />
                      </td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(item.totalTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{formatTokens(item.inputTokens)} / {formatTokens(item.outputTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{item.reasoningTokens ? formatTokens(item.reasoningTokens) : '—'}</td>
                      <td>{(item.requestCount || 0).toLocaleString()} 次</td>
                      <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--accent)' }}>
                        {formatUsd(item.estimatedCostUsd)}
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
                  {models.map((item) => (
                    <tr key={item.name}>
                      <td style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{item.name}</td>
                      <td style={{ minWidth: '120px' }}>
                        <PercentageCell value={item.percentage} />
                      </td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(item.totalTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{formatTokens(item.inputTokens)} / {formatTokens(item.outputTokens)}</td>
                      <td style={{ color: 'var(--muted)' }}>{item.reasoningTokens ? formatTokens(item.reasoningTokens) : '—'}</td>
                      <td>{(item.requestCount || 0).toLocaleString()} 次</td>
                      <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--accent)' }}>
                        {formatUsd(item.estimatedCostUsd)}
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
                    <p>展示当前统计范围内各客户端近期的每一次独立请求调用与明细。</p>
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
                  {records.map((record, idx) => (
                    <tr key={record.id || `${record.timestamp}-${record.model}-${idx}`}>
                      <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                        {formatDateTime(record.timestamp)}
                      </td>
                      <td>
                        <span className="client-badge">{record.client || 'unknown'}</span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>{record.provider}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 550 }}>{record.model}</td>
                      <td>{formatTokens(record.input)}</td>
                      <td>
                        {formatTokens(record.output)}
                        {record.reasoning ? <span style={{ color: 'var(--chart-secondary)', fontSize: '10.5px', marginLeft: '4px' }}>({formatTokens(record.reasoning)})</span> : null}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{record.cacheRead ? formatTokens(record.cacheRead) : '—'}</td>
                      <td style={{ fontWeight: 650 }}>{formatTokens(record.totalTokens)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                        {formatUsd(record.estimatedCostUsd, 4)}
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
