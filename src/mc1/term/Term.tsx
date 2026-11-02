import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import "./term.css";

export type TermHandle = {
  write(data: Uint8Array | string): void;
  clear(): void;
  focus(): void;
};

type Props = {
  ref?: Ref<TermHandle>;
  /** what the visitor typed, as bytes */
  onData(bytes: Uint8Array): void;
  /** every key event first; false keeps it from the terminal */
  onKey?(e: KeyboardEvent): boolean;
  label: string;
};

/** the terminal's colours and type are the site's tokens, read from the page */
function look(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    fontFamily: v("--font-mono") || "ui-monospace, Menlo, monospace",
    theme: {
      background: v("--card"),
      foreground: v("--ink"),
      cursor: v("--ink"),
      cursorAccent: v("--card"),
      selectionBackground: v("--line-2"),
      selectionForeground: v("--ink"),
    },
  };
}

export function Term({ ref, onData, onKey, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const handlers = useRef({ onData, onKey });
  handlers.current = { onData, onKey };

  useImperativeHandle(ref, () => ({
    write: (data) => term.current?.write(data),
    clear: () => term.current?.reset(),
    focus: () => term.current?.focus(),
  }), []);

  useEffect(() => {
    const el = box.current!;
    const { fontFamily, theme } = look(el);
    const t = new Terminal({
      fontFamily,
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 2000,
      theme,
      allowProposedApi: false,
      screenReaderMode: false,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    t.textarea?.setAttribute("aria-label", label);
    term.current = t;
    const enc = new TextEncoder();
    const data = t.onData((s) => handlers.current.onData(enc.encode(s)));
    t.attachCustomKeyEventHandler((e) => handlers.current.onKey?.(e) ?? true);
    const refit = () => { try { fit.fit(); } catch { /* not laid out yet */ } };
    // measure again once the mono font is in, or the cells are the fallback font's
    document.fonts?.ready.then(() => { t.options.fontFamily = look(el).fontFamily; refit(); });
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    const mo = new MutationObserver(() => { t.options.theme = look(el).theme; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      data.dispose();
      t.dispose();
      term.current = null;
    };
  }, [label]);

  return <div className="mc1-term" ref={box} />;
}
