import React, { useEffect, useRef } from 'react';

/**
 * General-purpose modal for the app.
 * variant: "alert"   — single OK button, no cancel
 *          "confirm" — OK + Cancel (default)
 *          "input"   — text input + OK + Cancel (replaces prompt())
 */
export default function AppModal({
  open,
  variant = 'confirm',
  title,
  message,
  confirmText,
  cancelText = 'Cancel',
  inputPlaceholder = '',
  inputValue = '',
  onInputChange,
  onConfirm,
  onCancel,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && variant === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, variant]);

  if (!open) return null;

  const defaultConfirm = variant === 'alert' ? 'OK' : variant === 'input' ? 'Save' : 'Delete';
  const btnLabel = confirmText ?? defaultConfirm;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && variant === 'input') onConfirm?.();
    if (e.key === 'Escape') onCancel?.();
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {title && <div className="modal-title">{title}</div>}
        {message && <div className="modal-message">{message}</div>}
        {variant === 'input' && (
          <input
            ref={inputRef}
            className="modal-input"
            type="text"
            placeholder={inputPlaceholder}
            value={inputValue}
            onChange={(e) => onInputChange?.(e.target.value)}
          />
        )}
        <div className="modal-actions">
          {variant !== 'alert' && (
            <button className="modal-btn-cancel" onClick={onCancel}>{cancelText}</button>
          )}
          <button
            className={`modal-btn-confirm${variant === 'alert' || variant === 'input' ? ' safe' : ''}`}
            onClick={variant === 'alert' ? (onConfirm ?? onCancel) : onConfirm}
          >
            {btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
