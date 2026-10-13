import React, { useState } from 'react';
import type { ConsoleSettings, ProviderQuota } from '../types';
import { deleteAccount, updateAccount } from '../api';

interface EditAccountDialogProps {
  quota: ProviderQuota | null;
  onClose: () => void;
  onSaved: (settings: ConsoleSettings) => void;
}

export const EditAccountDialog: React.FC<EditAccountDialogProps> = ({ quota, onClose, onSaved }) => {
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
        <h3 id="edit-account-title">编辑账户</h3>
        <label className="path-field">
          <span className="path-label">用户 ID</span>
          <input className="settings-input" value={quota.userId || '—'} readOnly />
        </label>
        <label className="path-field">
          <span className="path-label">显示名称</span>
          <input className="settings-input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="path-field">
          <span className="path-label">备注</span>
          <textarea className="settings-input settings-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={remove} disabled={busy}>移除卡片</button>
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="button-primary" onClick={save} disabled={busy}>保存</button>
        </div>
      </div>
    </div>
  );
};
