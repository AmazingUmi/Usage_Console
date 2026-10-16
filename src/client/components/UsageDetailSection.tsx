import React, { useState } from 'react';
import type { GroupedUsage, SpeedReport, TokenUsageRecord } from '../types';
import { formatDateTime, formatMillis, formatTokPerSec, formatTokens, formatUsd } from '../lib/format';
import { useI18n } from '../i18n';
import { HelpTip, type HelpSection } from './HelpTip';

interface UsageDetailSectionProps {
  models: GroupedUsage[];
  clients: GroupedUsage[];
  providers: GroupedUsage[];
  records: TokenUsageRecord[];
  speed: SpeedReport | null;
}

type Tab = 'software' | 'model' | 'records' | 'speed';

function PercentageCell({ value }: { value: number }) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="pct-cell">
      <div className="breakdown-track"><span style={{ width: `${percent}%` }} /></div>
      <span>{percent}%</span>
    </div>
  );
}

const GroupTable: React.FC<{ items: GroupedUsage[]; nameLabel: string; mono?: boolean }> = ({ items, nameLabel, mono }) => {
  const { t, locale } = useI18n();
  return (
  <table className="data-table">
    <thead>
      <tr>
        <th>{nameLabel}</th>
        <th>{t('detail.share')}</th>
        <th className="num">Tokens</th>
        <th className="num">{t('detail.input')}</th>
        <th className="num">{t('detail.output')}</th>
        <th className="num">{t('detail.reasoning')}</th>
        <th className="num">{t('detail.requests')}</th>
        <th className="num">{t('detail.cost')}</th>
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
          <td className="num">{(item.requestCount || 0).toLocaleString(locale)}</td>
          <td className="num strong">{formatUsd(item.estimatedCostUsd, 2)}</td>
        </tr>
      ))}
      {items.length === 0 && (
        <tr><td colSpan={8} className="empty">{t('detail.noRecords')}</td></tr>
      )}
    </tbody>
  </table>
  );
};

const SPEED_HELP: Array<{ title: string; body: string }> = [
  { title: 'speed.help.ttftTitle', body: 'speed.help.ttft' },
  { title: 'speed.help.outputTitle', body: 'speed.help.output' },
  { title: 'speed.help.medianTitle', body: 'speed.help.median' },
  { title: 'speed.help.p90Title', body: 'speed.help.p90' },
  { title: 'speed.help.samplesTitle', body: 'speed.help.samples' },
  { title: 'speed.help.coverageTitle', body: 'speed.help.coverage' },
];

function speedHelp(t: (key: string) => string): HelpSection[] {
  return SPEED_HELP.map((item) => ({ title: t(item.title), body: t(item.body) }));
}

function SpeedTable({ speed }: { speed: SpeedReport | null }) {
  const { t, locale } = useI18n();
  const rate = (value: number | null) => (value == null ? '—' : t('speed.perSec', { n: formatTokPerSec(value, locale) }));
  return (
    <>
      {speed && (speed.ttftSamples > 0 || speed.speedSamples > 0) ? (
        <>
          <div className="speed-stats">
            <div>
              <span>{t('speed.ttft')}</span>
              <strong>{formatMillis(speed.ttftMedianMs)}</strong>
            </div>
            <div>
              <span>{t('speed.output')}</span>
              <strong>{rate(speed.tokensPerSecondMedian)}</strong>
            </div>
          </div>
          <p className="speed-summary">{t('speed.summary', {
            requests: speed.requestCount,
            ttft: speed.ttftSamples,
            speed: speed.speedSamples,
          })}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('detail.model')}</th>
                <th>{t('detail.software')}</th>
                <th className="num">{t('speed.ttft')}</th>
                <th className="num">{t('speed.ttftP90')}</th>
                <th className="num">{t('speed.ttftSamples')}</th>
                <th className="num">{t('speed.output')}</th>
                <th className="num">{t('speed.outputP90')}</th>
                <th className="num">{t('speed.speedSamples')}</th>
              </tr>
            </thead>
            <tbody>
              {speed.groups.map((group) => (
                <tr key={`${group.client}:${group.model}`}>
                  <td className="strong mono">{group.model}</td>
                  <td><span className="chip">{group.client}</span></td>
                  <td className="num">{formatMillis(group.ttftMedianMs)}</td>
                  <td className="num muted">{formatMillis(group.ttftP90Ms)}</td>
                  <td className="num">{group.ttftSamples.toLocaleString(locale)}</td>
                  <td className="num strong">{rate(group.tokensPerSecondMedian)}</td>
                  <td className="num muted">{rate(group.tokensPerSecondP90)}</td>
                  <td className="num">{group.speedSamples.toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="empty">{t('speed.empty')}</p>
      )}
    </>
  );
}

export const UsageDetailSection: React.FC<UsageDetailSectionProps> = ({ models, clients, records, speed }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('software');

  return (
    <section className="section" data-module="detail" aria-labelledby="usage-title">
      <div className="section-heading">
        <div className="title-row">
          <h2 id="usage-title">{t('detail.title')}</h2>
          {tab === 'speed'
            ? <HelpTip label={t('speed.help')} sections={speedHelp(t)} />
            : <HelpTip text={t('detail.hint')} />}
        </div>
        <div className="segmented" role="group" aria-label={t('detail.aria')}>
          <button type="button" aria-pressed={tab === 'software'} onClick={() => setTab('software')}>
            {t('detail.software')}<span className="count">{clients.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'model'} onClick={() => setTab('model')}>
            {t('detail.model')}<span className="count">{models.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'records'} onClick={() => setTab('records')}>
            {t('detail.recent')}<span className="count">{records.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'speed'} onClick={() => setTab('speed')}>
            {t('speed.tab')}<span className="count">{speed?.speedSamples ?? 0}</span>
          </button>
        </div>
      </div>

      <div className="panel table-scroll">
        {tab === 'software' && <GroupTable items={clients} nameLabel={t('detail.software')} />}
        {tab === 'model' && <GroupTable items={models} nameLabel={t('detail.model')} mono />}
        {tab === 'speed' && <SpeedTable speed={speed} />}
        {tab === 'records' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('detail.time')}</th>
                <th>{t('detail.software')}</th>
                <th>{t('detail.model')}</th>
                <th className="num">{t('detail.input')}</th>
                <th className="num">{t('detail.output')}</th>
                <th className="num">{t('detail.cacheHit')}</th>
                <th className="num">{t('detail.cacheWrite')}</th>
                <th className="num">{t('detail.cost')}</th>
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
                    {record.reasoning ? <span className="hint">{t('detail.reasoningNote', { n: formatTokens(record.reasoning) })}</span> : null}
                  </td>
                  <td className="num muted">{record.cacheRead ? formatTokens(record.cacheRead) : '—'}</td>
                  <td className="num muted">{record.cacheWrite ? formatTokens(record.cacheWrite) : '—'}</td>
                  <td className="num strong">{formatUsd(record.estimatedCostUsd, 4)}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={8} className="empty">{t('detail.noRequests')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
