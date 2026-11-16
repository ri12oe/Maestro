import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './primitives.tsx';

/* ── Focus trap shared by Sheet and Dialog ─────────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    // Focus an explicit target, else the dialog itself, so no control looks pre-selected.
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const [a, b] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}

/** Right-side sheet on md+, bottom sheet on phones. Focus is trapped; Esc closes. */
export function Sheet({ open, onClose, label, children, width = 'md:w-[min(560px,100vw)]', header }: {
  open: boolean; onClose: () => void; label: string; children: ReactNode; width?: string; header?: ReactNode;
}) {
  const ref = useModal(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 flex max-h-[90dvh] outline-none animate-sheet-up flex-col rounded-t-[14px] border-t border-line-strong bg-surface-1 shadow-[var(--shadow-glass)] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:animate-sheet-in md:rounded-none md:border-t-0 md:border-l ${width}`}
      >
        <span className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3 px-5 pt-4 md:px-6 md:pt-6">
          <div className="min-w-0 flex-1">{header}</div>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))] md:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useModal(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="alertdialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="relative w-full max-w-md animate-pop-in outline-none rounded-[14px] border border-line-strong bg-surface-1 p-6 shadow-[var(--shadow-glass)]">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

interface ToastItem { id: number; message: string; action?: { label: string; run: () => void } }
interface ToastApi { show: (message: string, action?: ToastItem['action']) => void }

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [paused, setPaused] = useState(false);
  const show = useCallback<ToastApi['show']>((message, action) => setToast({ id: Date.now(), message, action }), []);

  useEffect(() => {
    if (!toast || paused) return;
    const t = window.setTimeout(() => setToast(null), toast.action ? 6000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast, paused]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 md:bottom-6">
        {toast && (
          <div
            key={toast.id}
            role="status"
            onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
            className="pointer-events-auto flex min-h-11 max-w-full animate-pop-in items-center gap-4 rounded-full border border-white/[0.06] bg-surface-1/85 px-4 py-2 text-label shadow-[var(--shadow-glass)] backdrop-blur-xl backdrop-saturate-150"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button type="button" className="font-semibold underline underline-offset-[3px]" onClick={() => { toast.action!.run(); setToast(null); }}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
