import { useI18n } from '../i18n';
import type { UsageScanProgress } from '../types';

export function UsageScanIndicator({ progress }: { progress: UsageScanProgress | null }) {
  const { t } = useI18n();
  const label = t(progress ? 'overview.scanning' : 'overview.loading');
  const count = progress ? t('overview.scanCount', {
    done: progress.completedSources,
    total: progress.totalSources,
  }) : undefined;

  return (
    <div className="panel usage-scan">
      <div className="usage-scan-caption" aria-hidden="true">
        <span>{label}</span>
        {count && <span>{count}</span>}
      </div>
      <div
        className="breakdown-track usage-scan-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={progress?.totalSources}
        aria-valuenow={progress?.completedSources}
        aria-valuetext={count}
        data-indeterminate={progress ? undefined : 'true'}
      >
        <span style={progress ? { width: `${100 * progress.completedSources / progress.totalSources}%` } : undefined} />
      </div>
    </div>
  );
}
