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
        <label className="field">
          <span className="field-label">用户 ID</span>
          <input className="input" value={quota.userId || '—'} readOnly />
        </label>
        <label className="field">
          <span className="field-label">显示名称</span>
          <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">备注</span>
          <textarea className="input" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error && <p className="callout" data-tone="danger" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={remove} disabled={busy}>移除卡片</button>
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>保存</button>
        </div>
      </div>
    </div>
  );
};
