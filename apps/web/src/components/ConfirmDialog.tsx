import React from "react";
import { X, Loader2, AlertTriangle, AlertCircle } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  error?: string | null;
  icon?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDestructive = false,
  isLoading = false,
  error = null,
  icon,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-crm-border">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-md flex items-center justify-center ${
                isDestructive
                  ? "bg-red-50 border border-red-200 text-red-600"
                  : "bg-crm-accentSubtle border border-crm-accentBorder text-crm-accent"
              }`}
            >
              {icon ||
                (isDestructive ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                ))}
            </div>
            <h2 className="text-sm font-heading font-semibold text-crm-text">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Optional Inline Error Banner */}
        {error && (
          <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Message Body */}
        <div className="mt-4 space-y-2 text-xs text-crm-textSecondary leading-relaxed">
          {typeof message === "string" ? <p>{message}</p> : message}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 pt-3 border-t border-crm-border flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-md text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5 ${
              isDestructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-crm-accent hover:bg-crm-accentHover"
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
