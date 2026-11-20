import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function formatMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}

export function CloseIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
    </svg>
  );
}

/** Cream Walden modal: X top-right, optional footer separated by a rule. */
export function Modal({
  open,
  onClose,
  children,
  footer,
  width = "max-w-[430px]",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  labelledBy?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 pt-12 pb-10 animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative w-full ${width} rounded-lg bg-cream shadow-modal animate-pop-in`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute right-6 top-6 text-ink hover:opacity-70" aria-label="Close">
          <CloseIcon />
        </button>
        {children}
        {footer && <div className="flex justify-end gap-2 border-t border-[#E4E1D4] px-4 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export type ToastState = { message: string; tone?: "info" | "error" } | null;

export function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-pop-in">
      <div className={`rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-modal ${toast.tone === "error" ? "bg-alert" : "bg-forest"}`}>
        {toast.message}
      </div>
    </div>
  );
}
