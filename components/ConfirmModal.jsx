import React from 'react';

export default function ConfirmModal({ open, title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#0b1220', color: '#fff', padding: 20, borderRadius: 8, width: 520, boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
        {title && <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</div>}
        {message && <div style={{ color: '#ccc', marginBottom: 16, whiteSpace: 'pre-wrap' }}>{message}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{ background: 'transparent', color: '#ccc', border: '1px solid #2b2b2b', padding: '8px 12px', borderRadius: 6 }}>{cancelText}</button>
          <button onClick={onConfirm} style={{ background: '#d33', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 6 }}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
