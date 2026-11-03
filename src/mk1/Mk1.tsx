import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Flasher } from "./flash/Flasher";
import type { FirmwareSource } from "./flash/releases";
import { ConnectHelp, TerminalNote } from "./help/ConnectHelp";
import { deskOf, detectOs, usbTrouble } from "./help/platform";
import { LuCpu, LuLoaderCircle, LuPlay, LuSun, LuUnplug, LuUsb, SiGithub } from "./icons";
import { CardStage } from "./preview/CardStage";
import { LinkError, openCard, pickCard, serialTrouble, type CardLink, type Trouble } from "./serial/link";
import type { Shell } from "./shell/core";
import { loadShell } from "./shell/load";
import { Term, type TermHandle } from "./term/Term";
import "./mk1.css";

type Mode = "idle" | "try" | "card";

/** the shell's saved state in try it (unlocked chapters, the program), as the card keeps it in flash */
const STATE = "keetsta:mk1";
const loadState = (n: number) => {
  try {
    const b64 = localStorage.getItem(STATE);
    if (!b64) return null;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return bytes.length === n ? bytes : null;
  } catch {
    return null;
  }
};
const saveState = (s: Uint8Array) => {
  try {
    localStorage.setItem(STATE, btoa(String.fromCharCode(...s)));
  } catch { /* storage blocked: the progress lasts the visit */ }
};

const DEFAULT_FIRMWARE: FirmwareSource = { manifest: "/mk1/firmware/latest.json", github: "keetsta/mk1-shell" };

/** the page's own source, and the commit this build runs (vite.config.ts defines it; a build that doesn't
 *  shows the repo alone) */
export type Source = { repo: string; commit?: string; label?: string };
const BUILD = typeof __MK1_BUILD__ === "object" && __MK1_BUILD__ ? __MK1_BUILD__ : null;
const DEFAULT_SOURCE: Source = { repo: "keetsta/mk1-web", ...BUILD };
const blank = () => new Uint16Array(9);

/** with nothing connected the card waits as it does on a desk: a cursor blinking at the matrix's left */
const CURSOR = Uint16Array.from([0, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0]);
const DARK = blank();
const BLINK = 530; // ms, a terminal's

/** the site's --ease */
const EASE = [0.22, 1, 0.36, 1] as const;
/** the page's entrance: each block rises into place a little after the one before */
const rise = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay: 0.07 * i },
});

/** a panel opening under the buttons: grows from nothing, the column's gap included (the -20 margin gives
 *  the gap back only because .mk1 is a flex column: a grid track never goes below zero) */
function Unfold({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0, marginTop: -20, overflow: "hidden" }}
      animate={{ opacity: 1, height: "auto", marginTop: 0, transitionEnd: { overflow: "visible" } }}
      exit={{ opacity: 0, height: 0, marginTop: -20, overflow: "hidden" }}
      transition={{ duration: 0.42, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** a block that folds away where it stands, as Unfold does, but stays mounted so what's inside keeps its
 *  state; inert while folded. `enter` joins the page's entrance at that step */
function Fold({ open, enter, children }: { open: boolean; enter?: number; children: ReactNode }) {
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  return (
    <motion.div
      initial={enter === undefined ? false : { opacity: 0, y: 14 }}
      animate={
        open
          ? { opacity: 1, y: 0, height: "auto", marginTop: 0, transitionEnd: { overflow: "visible" } }
          : { opacity: 0, y: 0, height: 0, marginTop: -20, overflow: "hidden" }
      }
      transition={first.current && enter !== undefined ? rise(enter).transition : { duration: 0.42, ease: EASE }}
      inert={!open}
    >
      {children}
    </motion.div>
  );
}

/** keetsta.me/mk1: the card's shell over USB, its firmware, and the same shell running right here */
export function Mk1({ firmware = DEFAULT_FIRMWARE, source = DEFAULT_SOURCE }: { firmware?: FirmwareSource; source?: Source }) {
  const os = useMemo(detectOs, []);
  // a browser that can never open the card says so before anyone presses connect
  const away = useMemo(serialTrouble, []);
  const [mode, setMode] = useState<Mode>("idle");
  const [rows, setRows] = useState<Uint16Array>(blank);
  const [card, setCard] = useState<{ live: boolean; firmware: string | null }>({ live: false, firmware: null });
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [lux, setLux] = useState(512);
  const [running, setRunning] = useState(false);
  const [blink, setBlink] = useState(true);

  const term = useRef<TermHandle>(null);
  const shell = useRef<Shell | null>(null);
  const link = useRef<CardLink | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const inputs = useRef({ pressed, lux });
  inputs.current = { pressed, lux };
  const tryRows = useRef<Uint16Array>(blank());
  const reconnect = useRef(false);
  // try it's shell didn't load: the terminal stays open with the reason in it
  const [failed, setFailed] = useState(false);

  // the terminal takes the keyboard as it opens; folded it is inert, so not a moment before
  useEffect(() => {
    if (mode !== "idle") term.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== "idle") return;
    setBlink(true);
    const id = setInterval(() => setBlink((b) => !b), BLINK);
    return () => clearInterval(id);
  }, [mode]);

  // try it: the shell's clock, and whether a program holds the foreground
  useEffect(() => {
    if (mode !== "try") return;
    const id = setInterval(() => {
      const s = shell.current;
      if (!s) return;
      s.tick();
      setRunning(s.running());
    }, 20);
    return () => clearInterval(id);
  }, [mode]);

  const closeCard = async () => {
    const l = link.current;
    link.current = null;
    if (l) await l.close();
  };

  const startTry = async () => {
    setTrouble(null);
    if (modeRef.current === "try") return term.current?.focus();
    setFailed(false);
    await closeCard();
    term.current?.clear();
    setRows(tryRows.current);
    setMode("try");
    if (shell.current) {
      shell.current.input(Uint8Array.of(13)); // back to a fresh prompt
    } else {
      try {
        shell.current = await loadShell({
          write: (b) => term.current?.write(b),
          frame: (r) => {
            tryRows.current = r;
            if (modeRef.current === "try") setRows(r);
          },
          button: () => inputs.current.pressed,
          lux: () => inputs.current.lux,
          load: loadState,
          save: saveState,
          exit: () => {},
        });
      } catch (e) {
        term.current?.write(`\r\n${e instanceof Error ? e.message : e}\r\n`);
        setFailed(true);
        setMode("idle");
      }
    }
  };

  const connectCard = useCallback(async () => {
    setTrouble(null);
    const t = serialTrouble();
    if (t) return setTrouble(t);
    let port: SerialPort | null;
    try {
      port = await pickCard();
    } catch (e) {
      return setTrouble(e instanceof LinkError ? e.trouble : "blocked");
    }
    if (!port) return;
    setFailed(false);
    setConnecting(true);
    try {
      await closeCard();
      const l = await openCard(port, {
        text: (b) => term.current?.write(b),
        message: (m) => {
          if (m.kind === "hello") setCard({ live: true, firmware: m.firmware });
          else setRows(m.rows);
        },
        closed: (lost) => {
          if (link.current === l) link.current = null;
          setCard({ live: false, firmware: null });
          setMode((m) => (m === "card" ? "idle" : m));
          if (lost && !reconnect.current) setTrouble("lost");
        },
      });
      link.current = l;
      term.current?.clear();
      setRows(blank());
      setMode("card");
      term.current?.write("\x1b[2m(the card is on. press enter for its prompt)\x1b[0m\r\n");
    } catch (e) {
      setTrouble(e instanceof LinkError ? e.trouble : "busy");
    } finally {
      setConnecting(false);
    }
  }, []);

  // after a firmware install the card comes back on its own: reopen it
  useEffect(() => {
    if (!("serial" in navigator)) return;
    const back = () => {
      if (!reconnect.current) return;
      reconnect.current = false;
      setTimeout(connectCard, 400);
    };
    navigator.serial.addEventListener("connect", back);
    return () => navigator.serial.removeEventListener("connect", back);
  }, [connectCard]);

  useEffect(() => () => { link.current?.close(); }, []);

  const onData = useCallback((b: Uint8Array) => {
    if (modeRef.current === "try") shell.current?.input(b);
    else if (modeRef.current === "card") link.current?.write(b);
  }, []);

  // while a program runs in try it: space is the card's button, + and - the light
  const onKey = useCallback((e: KeyboardEvent) => {
    if (modeRef.current !== "try" || !shell.current?.running()) return true;
    if (e.key === " ") {
      if (e.type === "keydown" && !e.repeat) setPressed(true);
      if (e.type === "keyup") setPressed(false);
      return false;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      if (e.type === "keydown") setLux((l) => Math.max(0, Math.min(1023, l + (e.key === "-" ? -64 : 64))));
      return false;
    }
    return true;
  }, []);

  const status =
    mode === "try" ? "the shell, running in your browser"
    : mode === "card" ? (card.live ? `card on usb · firmware ${card.firmware ?? "----"}` : "card on usb")
    : connecting ? "connecting"
    : "nothing connected";

  const shown = mode === "idle" ? (blink ? CURSOR : DARK) : rows;
  const termOpen = mode !== "idle" || failed;

  return (
    <MotionConfig reducedMotion="user">
      <section className="mk1">
        <header className="mk1-head">
          <motion.h1 {...rise(0)}>mk-1</motion.h1>
          <motion.p {...rise(1)}>my business card, with a shell inside. plug it into usb-c and program its 16×9 led screen.</motion.p>
        </header>

        <motion.div className="mk1-stage" {...rise(2)}>
          {/* pressable whenever no real card is on: with one, the card's own button is the one that counts */}
          <CardStage rows={shown} pressable={mode !== "card"} pressed={pressed} onPress={setPressed} />
          <AnimatePresence initial={false}>
            {mode === "try" && (
              <motion.div
                key="controls"
                className="mk1-controls-fold"
                initial={{ opacity: 0, height: 0, marginTop: 0, overflow: "hidden" }}
                animate={{ opacity: 1, height: "auto", marginTop: 18, transitionEnd: { overflow: "visible" } }}
                exit={{ opacity: 0, height: 0, marginTop: 0, overflow: "hidden" }}
                transition={{ duration: 0.42, ease: EASE }}
              >
                <div className="mk1-controls">
                  <label className="mk1-light">
                    <LuSun size={17} />
                    <span>light</span>
                    <input type="range" min={0} max={1023} step={1} value={lux} onChange={(e) => setLux(Number(e.target.value))} />
                    <span className="mono mk1-light-value">{lux}</span>
                  </label>
                  <p className="mk1-hint">
                    {running ? "space holds the card's button, + and − change the light" : "the card's button works too: press it"}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div className="mk1-actions" {...rise(3)}>
          {mode === "card" ? (
            <button type="button" className="mk1-btn" onClick={closeCard}><LuUnplug size={17} /> disconnect</button>
          ) : (
            <button type="button" className="mk1-btn primary" onClick={connectCard} disabled={connecting}>
              {connecting ? <LuLoaderCircle className="mk1-spin" size={17} /> : <LuUsb size={17} />} connect the card
            </button>
          )}
          <button type="button" className="mk1-btn" onClick={startTry} aria-pressed={mode === "try"}>
            <LuPlay size={17} /> try it here
          </button>
          <button type="button" className="mk1-btn" onClick={() => setFlashOpen((o) => !o)} aria-expanded={flashOpen}>
            <LuCpu size={17} /> firmware
          </button>
          <span className="mk1-pill mk1-status" data-mode={mode}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={status}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                {status}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>

        <AnimatePresence initial={false}>
          {trouble && (
            <Unfold key="help">
              <ConnectHelp trouble={trouble} os={os} />
            </Unfold>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {flashOpen && (
            <Unfold key="flash">
              <Flasher
                source={firmware}
                onCard={card.firmware}
                connected={mode === "card"}
                bootloader={async () => { reconnect.current = true; await link.current?.bootloader(); }}
                usb={!usbTrouble()}
                desk={deskOf(os)}
                onFlashed={() => { reconnect.current = true; }}
              />
            </Unfold>
          )}
        </AnimatePresence>

        {/* only with something to talk to: a card or try it. mounted while folded, so what was written to it
            before it opened (the card's first words, the shell's banner) is there */}
        <Fold open={termOpen}>
          <div className="card mk1-term-card">
            <Term ref={term} onData={onData} onKey={onKey} label="the card's shell" />
          </div>
        </Fold>

        {/* the help panel above says the same at more length */}
        <Fold open={!trouble} enter={4}>
          <TerminalNote trouble={away} os={os} />
        </Fold>

        <motion.footer className="mk1-foot" {...rise(5)}>
          <a href={`https://github.com/${source.repo}`} target="_blank" rel="noreferrer">
            <SiGithub size={14} /> {source.repo}
          </a>
          {source.commit && (
            <span>
              running{" "}
              <a className="mono" href={`https://github.com/${source.repo}/commit/${source.commit}`} target="_blank" rel="noreferrer">
                {source.label ?? source.commit.slice(0, 7)}
              </a>
            </span>
          )}
        </motion.footer>
      </section>
    </MotionConfig>
  );
}
