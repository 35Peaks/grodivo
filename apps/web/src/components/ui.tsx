import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

export function Button({ variant = "secondary", size = "md", className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-card text-ink hover:bg-muted-bg",
        variant === "ghost" && "text-ink-2 hover:bg-muted-bg hover:text-ink",
        variant === "danger" && "border border-line bg-card text-critical hover:bg-muted-bg",
        className,
      )}
    />
  );
}

export function Card({ title, action, children, className, subtitle }:
  { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-card", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5 pt-4">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line bg-card px-5 py-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular tracking-tight", tone === "good" ? "text-good" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

const STAGE_TONE: Record<string, string> = {
  closed_won: "bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-good",
  closed_lost: "bg-muted-bg text-ink-3 line-through decoration-1",
  pilot: "bg-[color-mix(in_oklab,var(--series-1)_14%,transparent)] text-ink",
  negotiation: "bg-[color-mix(in_oklab,var(--series-1)_14%,transparent)] text-ink",
};
export function Badge({ children, stage, className }: { children: ReactNode; stage?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium",
      (stage && STAGE_TONE[stage]) || "bg-muted-bg text-ink-2", className)}>
      {children}
    </span>
  );
}

export function SegmentDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}
const inputCls = "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--series-1)] focus:outline-none";
const width = (c?: string) => (c && /(^|\s)w-/.test(c) ? "" : "w-full");
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, width(p.className), "h-9", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(inputCls, "w-full", p.className)} />;
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={cx(inputCls, width(p.className), "h-9 pr-8", p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40", wide ? "max-w-3xl" : "max-w-lg")}>
      {open && (
        <div>
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-muted-bg hover:text-ink" aria-label="Close">✕</button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="py-16 text-center text-sm text-ink-3">Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="rounded-lg border border-line bg-card p-4 text-sm text-critical">{(error as Error)?.message ?? "Something went wrong"}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
