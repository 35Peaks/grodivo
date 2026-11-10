// Lightweight SVG/HTML charts following the dataviz method: thin marks, 4px rounded data ends
// anchored to the baseline, 2px surface gaps, recessive grid, legends for 2+ series, direct
// value labels (relief for sub-3:1 slots), and a hover/focus tooltip on every mark.
import { useRef, useState, type ReactNode } from "react";
import { usd } from "../lib/format";

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; color?: string }[] } | null;

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number } | null, el: Element | null, t: Omit<NonNullable<Tip>, "x" | "y">) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    let x: number, y: number;
    if (e) { x = e.clientX - r.left; y = e.clientY - r.top; }
    else { const b = el!.getBoundingClientRect(); x = b.left - r.left + b.width / 2; y = b.top - r.top; }
    setTip({ ...t, x, y });
  };
  return { box, tip, show, hide: () => setTip(null) };
}

function TooltipView({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), Math.max(width - 200, 0));
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(tip.y - 12, 0), transform: "translateY(-100%)" }}>
      <div className="mb-1 font-medium text-ink-2">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            {r.color && <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold tabular text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontal bars, one per category, direct-labeled. */
export function BarList({ rows, format = (n) => usd(n, { compact: true }), onSelect }: {
  rows: { key: string; label: ReactNode; tipLabel: string; value: number; color: string; detail?: { label: string; value: string }[] }[];
  format?: (n: number) => string;
  onSelect?: (key: string) => void;
}) {
  const { box, tip, show, hide } = useTip();
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div ref={box} className="relative" onPointerLeave={hide}>
      <ul className="space-y-3">
        {rows.map((r) => {
          const t = { title: r.tipLabel, rows: [{ label: "Value", value: usd(r.value), color: r.color }, ...(r.detail ?? [])] };
          return (
            <li key={r.key}>
              <button type="button" className="group block w-full text-left" disabled={!onSelect}
                onClick={() => onSelect?.(r.key)}
                onPointerMove={(e) => show(e, null, t)} onFocus={(e) => show(null, e.currentTarget, t)} onBlur={hide}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-ink-2 group-hover:text-ink">{r.label}</span>
                  <span className="tabular font-semibold text-ink">{format(r.value)}</span>
                </div>
                <div className="h-2.5 w-full">
                  <div className="h-full rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                    style={{ width: `${r.value > 0 ? Math.max((r.value / max) * 100, 1) : 0}%`, background: r.color }} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <TooltipView tip={tip} width={box.current?.clientWidth ?? 400} />
    </div>
  );
}

/** Stacked columns over time (one axis), with total labels on top and a table toggle. */
export function StackedColumns({ data, series, height = 200 }: {
  data: { key: string; label: string; values: number[] }[];
  series: { label: string; color: string }[];
  height?: number;
}) {
  const { box, tip, show, hide } = useTip();
  const [table, setTable] = useState(false);
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Legend items={series} />
        <button className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setTable((t) => !t)}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-xs tabular">
          <thead><tr className="text-left text-ink-3"><th className="py-1 font-medium">Month</th>
            {series.map((s) => <th key={s.label} className="py-1 text-right font-medium">{s.label}</th>)}
            <th className="py-1 text-right font-medium">Total</th></tr></thead>
          <tbody>{data.map((d, i) => (
            <tr key={d.key} className="border-t border-line"><td className="py-1.5 text-ink-2">{d.label}</td>
              {d.values.map((v, j) => <td key={j} className="py-1.5 text-right">{usd(v)}</td>)}
              <td className="py-1.5 text-right font-semibold">{usd(totals[i])}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div ref={box} className="relative flex gap-2" onPointerLeave={hide}>
          <div className="relative w-12 shrink-0 text-right text-[10px] text-ink-3 tabular" style={{ height }}>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: height - (t / top) * height }}>{usd(t, { compact: true })}</span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t" style={{ top: height - (t / top) * height, borderColor: t === 0 ? "var(--text-muted)" : "var(--grid)" }} />
            ))}
            <div className="absolute inset-0 flex items-end justify-around gap-3 px-2">
              {data.map((d, i) => {
                const total = totals[i]!;
                const t = { title: d.label, rows: [...series.map((s, j) => ({ label: s.label, value: usd(d.values[j]), color: s.color })), { label: "Total", value: usd(total) }] };
                return (
                  <div key={d.key} tabIndex={0} aria-label={`${d.label}: ${usd(total)}`}
                    className="group relative flex h-full max-w-14 flex-1 flex-col justify-end outline-none"
                    onPointerMove={(e) => show(e, null, t)} onFocus={(e) => show(null, e.currentTarget, t)} onBlur={hide}>
                    {total > 0 && (
                      <span className="mb-1 text-center text-[10px] font-semibold text-ink tabular">{usd(total, { compact: true })}</span>
                    )}
                    <div className="flex flex-col-reverse gap-[2px] group-hover:brightness-110 group-focus-visible:brightness-110">
                      {d.values.map((v, j) => v > 0 && (
                        <div key={j} style={{ height: Math.max((v / top) * (height - 16), 2), background: series[j]!.color }}
                          className={j === lastNonZero(d.values) ? "rounded-t-[4px]" : ""} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <TooltipView tip={tip} width={box.current?.clientWidth ?? 400} />
        </div>
      )}
      {!table && (
        <div className="ml-14 mt-1.5 flex justify-around gap-3 px-2 text-[11px] text-ink-3">
          {data.map((d) => <span key={d.key} className="max-w-14 flex-1 text-center">{d.label}</span>)}
        </div>
      )}
    </div>
  );
}
const lastNonZero = (v: number[]) => v.reduce((acc, x, i) => (x > 0 ? i : acc), -1);

function niceTicks(max: number) {
  const step0 = max / 4;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

/** One horizontal bar split into parts (e.g. one-time vs recurring), labeled. */
export function SplitBar({ label, parts }: { label: string; parts: { label: string; value: number; color: string }[] }) {
  const { box, tip, show, hide } = useTip();
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div ref={box} className="relative" onPointerLeave={hide}>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="font-semibold tabular text-ink">{usd(total, { compact: true })}</span>
      </div>
      {total > 0 ? (
        <div className="flex h-3 gap-[2px]">
          {parts.filter((p) => p.value > 0).map((p, i, arr) => {
            const t = { title: label, rows: [{ label: p.label, value: `${usd(p.value)} (${Math.round((p.value / total) * 100)}%)`, color: p.color }] };
            return (
              <div key={p.label} tabIndex={0} aria-label={`${p.label}: ${usd(p.value)}`}
                className={"h-full outline-none hover:brightness-110 focus-visible:brightness-110 " + (i === arr.length - 1 ? "rounded-r-[4px]" : "")}
                style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
                onPointerMove={(e) => show(e, null, t)} onFocus={(e) => show(null, e.currentTarget, t)} onBlur={hide} />
            );
          })}
        </div>
      ) : <div className="h-3 rounded bg-muted-bg" />}
      <div className="mt-1 flex gap-3 text-[11px] text-ink-3 tabular">
        {parts.map((p) => <span key={p.label}>{p.label} {total ? Math.round((p.value / total) * 100) : 0}%</span>)}
      </div>
      <TooltipView tip={tip} width={box.current?.clientWidth ?? 400} />
    </div>
  );
}

/** Progress toward a target. */
export function Meter({ value, target, label }: { value: number; target: number; label: string }) {
  const p = target > 0 ? Math.min(value / target, 1) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        <span className="text-xs text-ink-3 tabular">{target > 0 ? `${((value / target) * 100).toFixed(1)}% of ${usd(target, { compact: true })}` : "No target set"}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular text-ink">{usd(value)}</div>
      <div className="mt-2 h-2 w-full rounded-full bg-muted-bg" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={target} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(p * 100, value > 0 ? 1 : 0)}%`, background: "var(--seq-strong)" }} />
      </div>
    </div>
  );
}
