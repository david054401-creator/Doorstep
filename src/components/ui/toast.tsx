'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  undoFn?: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ToastContextValue {
  showToast: (message: string, type: ToastType, undoFn?: () => void) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Toast styles ─────────────────────────────────────────────────────────────

const borderColor: Record<ToastType, string> = {
  success: '#5C8A3A',
  warning: '#D4923B',
  error:   '#B8442E',
};

const ToastIcon: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error:   XCircle,
};

const iconColor: Record<ToastType, string> = {
  success: '#5C8A3A',
  warning: '#D4923B',
  error:   '#B8442E',
};

// ─── Individual Toast ─────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 3000;

interface ToastProps extends ToastItem {
  onDismiss: (id: string) => void;
}

function Toast({ id, message, type, undoFn, onDismiss }: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTimer = useCallback(() => {
    timerRef.current = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
  }, [id, onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const Icon = ToastIcon[type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      className="toast"
      style={{ borderLeft: `4px solid ${borderColor[type]}` }}
      role="status"
      aria-live="polite"
    >
      {/* Icon */}
      <Icon size={18} style={{ color: iconColor[type], flexShrink: 0 }} strokeWidth={2} />

      {/* Message */}
      <span className="flex-1 text-sm leading-snug" style={{ color: '#F5F1EA' }}>
        {message}
      </span>

      {/* Undo button */}
      {undoFn && (
        <button
          type="button"
          onClick={() => {
            undoFn();
            onDismiss(id);
          }}
          className="shrink-0 text-sm font-semibold underline-offset-2 hover:underline transition-opacity hover:opacity-80"
          style={{ color: '#C75D3D' }}
        >
          Undo
        </button>
      )}

      {/* Close */}
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
        aria-label="Dismiss"
      >
        <X size={14} style={{ color: '#A8A099' }} />
      </button>
    </motion.div>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-container">
      <AnimatePresence mode="sync" initial={false}>
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType, undoFn?: () => void) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, type, undoFn }]);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}

// ─── Re-export standalone container (for custom setups) ───────────────────────
export { ToastContainer };
