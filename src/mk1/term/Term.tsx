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

/** macOS copies and pastes with cmd, which xterm leaves to the browser */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** the selection to the clipboard; without the async clipboard, the browser's copy, which xterm answers */
function copy(t: Terminal) {
  const text = t.getSelection();
  if (!text) return;
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  else document.execCommand("copy");
  t.clearSelection();
}

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
  /** what was written before the cells were measured with the real font, held back: wrapped at the
   *  fallback's width, xterm would lose its line ends when it narrows */
  const early = useRef<(Uint8Array | string)[] | null>([]);

  useImperativeHandle(ref, () => ({
    write: (data) => {
      if (early.current) early.current.push(data);
      else term.current?.write(data);
    },
    clear: () => {
      if (early.current) early.current = [];
      term.current?.reset();
    },
    focus: () => term.current?.focus(),
  }), []);

  useEffect(() => {
    const el = box.current!;
    early.current = [];
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
    // elsewhere ctrl does both, as in a terminal on the visitor's desk: ctrl+c copies what's selected (with
    // nothing selected it is still the shell's interrupt), ctrl+shift+c copies, ctrl+v and ctrl+shift+v
    // paste. Left to xterm they would only send ^C and ^V, and the browser would never copy or paste
    t.attachCustomKeyEventHandler((e) => {
      if (!MAC && e.ctrlKey && !e.altKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "c" && (e.shiftKey || t.hasSelection())) {
          if (e.type === "keydown") copy(t);
          return false;
        }
        // not handled here: the browser pastes into xterm's textarea and xterm takes it from there
        if (k === "v") return false;
      }
      return handlers.current.onKey?.(e) ?? true;
    });
    const refit = () => { try { fit.fit(); } catch { /* not laid out yet */ } };
    // the cells are measured with whichever mono font is in when the terminal opens, so once the site's is
    // loaded, measure again. Without it the cells keep the fallback's width (Consolas is 8% narrower than
    // Geist Mono): lines run past the right edge and a mouse selection drifts off the letters. xterm ignores
    // an option set to the value it already has, hence the round trip through another family
    const family = look(el).fontFamily;
    document.fonts
      ?.load(`14px ${family}`)
      .catch(() => [])
      .then(() => {
        if (term.current !== t) return;
        t.options.fontFamily = "monospace";
        t.options.fontFamily = family;
        refit();
        for (const d of early.current ?? []) t.write(d);
        early.current = null;
      });
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    const mo = new MutationObserver(() => { t.options.theme = look(el).theme; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      data.dispose();
      // a task later: xterm's viewport syncs itself on a timer set when it opened, and finding the terminal
      // already gone it throws (React's dev mode opens and closes it at once)
      setTimeout(() => t.dispose());
      term.current = null;
    };
  }, [label]);

  return <div className="mk1-term" ref={box} />;
}
