"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search } from "lucide-react";
import { searchSymbols, type SymbolResult } from "@/lib/api";

export default function PanelSymbolSearch({
  symbol,
  index,
  ar,
  onSelect,
}: {
  symbol: string;
  index: number;
  ar: boolean;
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320 });
  const form = useRef<HTMLFormElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    setQuery(symbol);
    setOpen(false);
  }, [symbol]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = form.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top:
          window.innerHeight - rect.bottom >= 180
            ? rect.bottom + 6
            : Math.max(8, rect.top - 300),
        width,
      });
    };
    const dismiss = (event: PointerEvent) => {
      if (
        !form.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setActive(-1);
    setError(false);
    if (!open || !query.trim()) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      searchSymbols(
        query.trim(),
        "Egypt",
        12,
        controller.signal,
        "supabase",
        "EGX",
      )
        .then((rows) => {
          if (controller.signal.aborted) return;
          const seen = new Set<string>();
          setResults(
            (Array.isArray(rows) ? rows : [])
              .filter((row) => {
                if (
                  !row ||
                  typeof row.symbol !== "string" ||
                  !/^[A-Za-z0-9._-]{1,24}$/.test(row.symbol) ||
                  String(row.exchange).toUpperCase() !== "EGX" ||
                  seen.has(row.symbol)
                )
                  return false;
                seen.add(row.symbol);
                return true;
              })
              .slice(0, 12),
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, open]);
  const choose = (value: string) => {
    const selected = value.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,24}$/.test(selected)) return;
    setQuery(selected);
    setOpen(false);
    if (selected !== symbol.toUpperCase()) onSelect(selected);
  };
  return (
    <>
      <form
        ref={form}
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const exact = results.find(
            (row) => row.symbol.toUpperCase() === query.trim().toUpperCase(),
          );
          if (active >= 0 && results[active]) choose(results[active].symbol);
          else if (exact) choose(exact.symbol);
          else if (results[0]) choose(results[0].symbol);
          else setOpen(true);
        }}
      >
        <input
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-results`}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          aria-label={
            ar
              ? `بحث سهم الشارت ${index + 1}`
              : `Chart ${index + 1} stock search`
          }
          name="symbol"
          value={query}
          maxLength={80}
          autoComplete="off"
          placeholder={ar ? "اسم أو رمز السهم" : "Name or symbol"}
          title={
            ar
              ? "ابحث باسم الشركة أو رمز السهم واختر من النتائج"
              : "Search company name or stock symbol and choose a result"
          }
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setResults([]);
            setActive(-1);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.stopPropagation();
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((previous) =>
                !results.length
                  ? -1
                  : previous < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : results.length - 1
                    : (previous +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        results.length) %
                      results.length,
              );
            }
          }}
          className="app-control w-28 min-w-0 rounded-lg px-2 py-1 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        />
        <button
          className="app-chip shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
          type="submit"
        >
          {ar ? "تغيير السهم" : "Change symbol"}
        </button>
        <button
          type="button"
          aria-label={
            ar
              ? `بحث أسهم النافذة ${index + 1}`
              : `Search chart ${index + 1} stocks`
          }
          onClick={() => {
            setOpen(true);
            input.current?.focus();
          }}
          className="app-icon-button shrink-0 rounded-lg p-1.5"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </form>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popup}
            className="app-panel-strong !transform-none fixed z-[120] overflow-hidden rounded-xl"
            style={{ ...position, background: "var(--brutal-bg-card)" }}
            dir={ar ? "rtl" : "ltr"}
          >
            <div className="app-text-muted border-b border-[var(--app-border)] px-3 py-2 text-xs">
              {ar
                ? "اختَر السهم لهذه النافذة"
                : "Choose a stock for this panel"}
            </div>
            {loading ? (
              <p role="status" className="flex items-center gap-2 p-3 text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                {ar ? "جارٍ البحث…" : "Searching…"}
              </p>
            ) : error ? (
              <p role="alert" className="p-3 text-xs text-red-500">
                {ar
                  ? "تعذر البحث. حاول الكتابة مرة أخرى."
                  : "Search failed. Try typing again."}
              </p>
            ) : !query.trim() ? (
              <p className="app-text-muted p-3 text-xs">
                {ar
                  ? "اكتب اسم الشركة أو رمز السهم"
                  : "Type a company name or stock symbol"}
              </p>
            ) : !results.length ? (
              <p role="status" className="app-text-muted p-3 text-xs">
                {ar ? "لا توجد نتائج مطابقة" : "No matching stocks"}
              </p>
            ) : null}
            <div
              id={`${id}-results`}
              role="listbox"
              aria-label={ar ? "نتائج بحث الأسهم" : "Stock search results"}
              className="max-h-64 overflow-y-auto"
            >
              {results.map((row, resultIndex) => (
                <button
                  key={row.symbol}
                  id={`${id}-${resultIndex}`}
                  role="option"
                  aria-selected={active === resultIndex}
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    choose(row.symbol);
                    input.current?.focus();
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 border-b border-[var(--app-border)] px-3 py-3 text-start text-xs hover:bg-amber-500/10 ${active === resultIndex ? "bg-amber-500/15" : ""}`}
                >
                  <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                    {row.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {typeof row.name === "string" ? row.name : row.symbol}
                  </span>
                  <span className="app-text-muted text-[10px]">EGX</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
