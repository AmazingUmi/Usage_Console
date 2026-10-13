import React, { useState } from 'react';
import type { ConsoleSettings, ProviderQuota } from '../types';
import { deleteAccount, updateAccount } from '../api';
import { useI18n } from '../i18n';

interface EditAccountDialogProps {
  quota: ProviderQuota | null;
  onClose: () => void;
  onSaved: (settings: ConsoleSettings) => void;
}

export const EditAccountDialog: React.FC<EditAccountDialogProps> = ({ quota, onClose, onSaved }) => {
  const { t } = useI18n();
  const [label, setLabel] = useState(quota?.displayName || '');
  const [notes, setNotes] = useState(quota?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!quota?.accountCardId) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updateAccount(quota.accountCardId!, { label, notes });
      onSaved(result.settings);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount(quota.accountCardId!);
      onSaved(result.settings);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-account-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="edit-account-title">{t('edit.title')}</h3>
        <label className="field">
          <span className="field-label">{t('edit.userId')}</span>
          <input className="input" value={quota.userId || '—'} readOnly />
        </label>
        <label className="field">
          <span className="field-label">{t('edit.name')}</span>
          <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('edit.notes')}</span>
          <textarea className="input" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error && <p className="callout" data-tone="danger" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={remove} disabled={busy}>{t('edit.remove')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('edit.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{t('edit.save')}</button>
        </div>
      </div>
    </div>
  );
};
