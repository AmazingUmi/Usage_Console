import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface RefreshIntervalSettingProps {
  seconds: number;
  disabled?: boolean;
  /** Resolves when saved; a rejection is shown to the user and the previous value is restored. */
  onSave: (seconds: number) => Promise<void>;
}

const PRESETS = [30, 60, 120, 300, 600, 0];
const MIN = 30;
const MAX = 3600;

export const RefreshIntervalSetting: React.FC<RefreshIntervalSettingProps> = ({ seconds, disabled, onSave }) => {
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(String(seconds || 90));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = custom || !PRESETS.includes(seconds) ? 'custom' : String(seconds);

  useEffect(() => setDraft(String(seconds || 90)), [seconds]);

  const save = async (next: number) => {
    if (!Number.isInteger(next) || (next !== 0 && (next < MIN || next > MAX))) {
      setError(t('settings.refresh.invalid'));
      return;
    }
    setError(null);
    if (next === seconds) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      setDraft(String(seconds || 90));
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const label = (value: number) => {
    if (value === 0) return t('settings.refresh.off');
    return value < 60 ? t('settings.refresh.seconds', { n: value }) : t('settings.refresh.minutes', { n: value / 60 });
  };

  const saveCustom = () => {
    const next = draft.trim() ? Number(draft) : NaN;
    if (next === 0) {
      setError(t('settings.refresh.invalid'));
      return;
    }
    void save(next);
  };

  return (
    <>
      <div className="refresh-control">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label={t('settings.refresh.title')}
          value={selected}
          disabled={disabled || saving}
          onChange={(event) => {
            setError(null);
            setCustom(event.target.value === 'custom');
            if (event.target.value !== 'custom') void save(Number(event.target.value));
          }}
        >
          {PRESETS.map((value) => <option key={value} value={String(value)}>{label(value)}</option>)}
          <option value="custom">{t('settings.refresh.custom')}</option>
        </select>
        {selected === 'custom' && (
          <>
            <input
              className="input"
              type="number"
              min={MIN}
              max={MAX}
              step={1}
              value={draft}
              disabled={disabled || saving}
              aria-label={t('settings.refresh.custom')}
              aria-invalid={Boolean(error)}
              onChange={(event) => { setDraft(event.target.value); setError(null); }}
              onBlur={saveCustom}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCustom(); } }}
            />
            <span className="hint">{t('settings.refresh.unit')}</span>
          </>
        )}
      </div>
      {error && <p className="callout" data-tone="danger" role="alert">{error}</p>}
    </>
  );
};
