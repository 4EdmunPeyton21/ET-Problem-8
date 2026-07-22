import { useUIStore } from '../../stores/uiStore';
import { CheckCircle2, AlertCircle, XCircle, X } from 'lucide-react';

const VARIANTS = {
  success: { icon: CheckCircle2, className: 'border-success/30 text-success' },
  error: { icon: XCircle, className: 'border-error/30 text-error' },
  warning: { icon: AlertCircle, className: 'border-warning/30 text-warning' },
};

export const Toast = () => {
  const activeToast = useUIStore((state) => state.activeToast);
  const clearToast = useUIStore((state) => state.clearToast);

  if (!activeToast) return null;

  const { icon: Icon, className } = VARIANTS[activeToast.type] || VARIANTS.success;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm sm:right-6 sm:bottom-6">
      <div className={`pop-in surface flex items-start gap-3 border p-4 shadow-lg ${className}`}>
        <Icon className="size-5 shrink-0" strokeWidth={2} />
        <p className="flex-1 text-sm font-medium text-ink">{activeToast.message}</p>
        <button
          onClick={clearToast}
          aria-label="Dismiss"
          className="shrink-0 text-muted transition-colors hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
};
