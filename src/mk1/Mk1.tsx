import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { EASE, Unfold } from "./anim";
import { Flasher, useLatest } from "./flash/Flasher";
import { isNewer, type FirmwareSource } from "./flash/releases";
import { UpdateBanner } from "./flash/Update";
import { ConnectHelp, NoAnswer, TerminalNote } from "./help/ConnectHelp";
import { deskOf, detectOs, isFirefox, usbTrouble } from "./help/platform";
import { LuCpu, LuLoaderCircle, LuPlay, LuSun, LuUnplug, LuUsb, SiGithub } from "./icons";
import { CardStage } from "./preview/CardStage";
import { dark, fromRows, type Screen } from "./screen";
import { LinkError, askCard, knownCard, openCard, serialTrouble, type CardLink, type Trouble } from "./serial/link";
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
/** with nothing connected the card waits as it does on a desk: a cursor blinking at the matrix's left */
const CURSOR = fromRows([0, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0x7000, 0]);
const DARK = dark();
const BLINK = 530; // ms, a terminal's
/** a card answers the page's hello within a tick (20 ms); a port still quiet after this is not one */
const HELLO_MS = 1500;

/** the page's entrance: each block rises into place a little after the one before */
const rise = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay: 0.07 * i },
});

/** what's connected, in a pill that eases to the width of what it says instead of jumping to it */
function Status({ text, mode }: { text: string; mode: string }) {
  const inner = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current!;
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.span
      className="mk1-pill mk1-status"
      data-mode={mode}
      initial={false}
      animate={{ width }}
      transition={{ duration: 0.36, ease: EASE }}
    >
      <span ref={inner} className="mk1-status-text">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={text}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
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
  const firefox = useMemo(isFirefox, []);
  const [mode, setMode] = useState<Mode>("idle");
  const [screen, setScreen] = useState<Screen>(dark);
  const [card, setCard] = useState<{ live: boolean; firmware: string | null }>({ live: false, firmware: null });
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [connecting, setConnecting] = useState(false);
  // the browser's port list is open (in Firefox, the first time, its permission add-on before it)
  const [picking, setPicking] = useState(false);
  // the port is open but nothing on it said hello
  const [silent, setSilent] = useState(false);
  const quiet = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [flashOpen, setFlashOpen] = useState(false);
  // the panel was opened from the update banner: its install button takes the keyboard
  const [flashFromBanner, setFlashFromBanner] = useState(false);
  const latest = useLatest(firmware);
  // the release whose banner the visitor closed: it stays closed for the visit, a newer one opens it again
  const [skipped, setSkipped] = useState<string | null>(null);
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
  const tryScreen = useRef<Screen>(dark());
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
    setScreen(tryScreen.current);
    setMode("try");
    if (shell.current) {
      shell.current.input(Uint8Array.of(13)); // back to a fresh prompt
    } else {
      try {
        shell.current = await loadShell({
          write: (b) => term.current?.write(b),
          frame: (r) => {
            tryScreen.current = fromRows(r);
            if (modeRef.current === "try") setScreen(tryScreen.current);
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

  const open = useCallback(async (port: SerialPort) => {
    setFailed(false);
    setSilent(false);
    setConnecting(true);
    try {
      await closeCard();
      let hello = false;
      const l = await openCard(port, {
        text: (b) => term.current?.write(b),
        message: (m) => {
          if (m.kind === "hello") {
            hello = true;
            setSilent(false);
            setCard({ live: true, firmware: m.firmware });
          } else setScreen(m.screen);
        },
        closed: (lost) => {
          if (link.current === l) link.current = null;
          setSilent(false);
          setCard({ live: false, firmware: null });
          setMode((m) => (m === "card" ? "idle" : m));
          if (lost && !reconnect.current) setTrouble("lost");
        },
      });
      link.current = l;
      term.current?.clear();
      setScreen(dark());
      setMode("card");
      clearTimeout(quiet.current);
      quiet.current = setTimeout(() => {
        if (!hello && link.current === l) setSilent(true);
      }, HELLO_MS);
    } catch (e) {
      setTrouble(e instanceof LinkError ? e.trouble : "busy");
    } finally {
      setConnecting(false);
    }
  }, []);

  /** fresh: the browser's list even when the site knows a port, for when the one it knows isn't the card */
  const connectCard = async (fresh = false) => {
    setTrouble(null);
    const t = serialTrouble();
    if (t) return setTrouble(t);
    let port: SerialPort | null;
    try {
      port = fresh ? null : await knownCard();
      if (!port) {
        setPicking(true);
        port = await askCard();
      }
    } catch (e) {
      return setTrouble(e instanceof LinkError ? e.trouble : "blocked");
    } finally {
      setPicking(false);
    }
    if (port) await open(port);
  };

  /** the card into its bootloader for an install, no hand on it: through the terminal's link, or, with the
   *  terminal closed, through the port the site was allowed before, once the card on it has said hello. The
   *  port filter lets any pico-sdk board through, and a 1200-baud touch would send another board to its
   *  bootloader to take this firmware */
  const toBootloader = async (): Promise<boolean> => {
    if (link.current) {
      reconnect.current = true;
      await link.current.bootloader();
      return true;
    }
    if (serialTrouble()) return false;
    const port = await knownCard().catch(() => null);
    if (!port) return false;
    let hello = false;
    let probe: CardLink;
    try {
      probe = await openCard(port, {
        text: () => {},
        message: (m) => { if (m.kind === "hello") hello = true; },
        closed: () => {},
      });
    } catch {
      return false; // another tab holds it
    }
    for (let t = 0; t < HELLO_MS && !hello; t += 50) await new Promise((r) => setTimeout(r, 50));
    if (!hello) {
      await probe.close();
      return false;
    }
    reconnect.current = true;
    await probe.bootloader();
    return true;
  };

  // after a firmware install the card comes back on its own: reopen the port that came back (with two
  // allowed, the site's own list can't tell which one it is, and the picker needs a click)
  useEffect(() => {
    if (!("serial" in navigator)) return;
    const back = (e: Event) => {
      if (!reconnect.current) return;
      reconnect.current = false;
      const port = e.target as SerialPort;
      setTimeout(() => open(port), 400);
    };
    navigator.serial.addEventListener("connect", back);
    return () => navigator.serial.removeEventListener("connect", back);
  }, [open]);

  useEffect(() => () => {
    clearTimeout(quiet.current);
    link.current?.close();
  }, []);

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
    : mode === "card" ? (card.firmware ? `firmware ${card.firmware}` : card.live ? "connected" : silent ? "no answer" : "connecting")
    : picking ? "pick the card in the list"
    : connecting ? "connecting"
    : "nothing connected";

  const shown = mode === "idle" ? (blink ? CURSOR : DARK) : screen;
  const termOpen = mode !== "idle" || failed;

  // a release newer than the card that just said hello. the open firmware panel says the same at more length
  const rel = latest.s === "ok" ? latest.r : null;
  const update =
    rel && mode === "card" && card.firmware && isNewer(rel.version, card.firmware) && !flashOpen && skipped !== rel.version
      ? { release: rel, onCard: card.firmware }
      : null;

  // where this browser can never reach the card (an iPhone, Safari), the shell right here leads, and connect
  // only opens the way round
  const tryFirst = away !== null;
  const connectButton =
    mode === "card" ? (
      <button type="button" className="mk1-btn" onClick={closeCard}><LuUnplug size={17} /> disconnect</button>
    ) : (
      <button
        type="button"
        className={tryFirst ? "mk1-btn" : "mk1-btn primary"}
        onClick={() => connectCard()}
        disabled={connecting || picking}
      >
        {connecting ? <LuLoaderCircle className="mk1-spin" size={17} /> : <LuUsb size={17} />} connect the card
      </button>
    );
  const tryButton = (
    <button
      type="button"
      className={tryFirst && mode !== "try" ? "mk1-btn primary" : "mk1-btn"}
      onClick={startTry}
      aria-pressed={mode === "try"}
    >
      <LuPlay size={17} /> try it here
    </button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <section className="mk1">
        <header className="mk1-head">
          <motion.h1 {...rise(0)}>mk-1</motion.h1>
        </header>

        <motion.div className="mk1-stage" {...rise(1)}>
          {/* pressable whenever no real card is on: with one, the card's own button is the one that counts */}
          <CardStage screen={shown} pressable={mode !== "card"} pressed={pressed} onPress={setPressed} />
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
                    <input
                      type="range"
                      min={0}
                      max={1023}
                      step={1}
                      value={lux}
                      onChange={(e) => setLux(Number(e.target.value))}
                      style={{ "--fill": `${(lux / 1023) * 100}%` } as CSSProperties}
                    />
                    <span className="mono mk1-light-value">{lux}</span>
                  </label>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={running ? "running" : "idle"}
                      className="mk1-hint"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      {running ? "space holds the card's button, + and − change the light" : "the card's button works too: press it"}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div className="mk1-actions" {...rise(2)}>
          {tryFirst ? <>{tryButton}{connectButton}</> : <>{connectButton}{tryButton}</>}
          <button
            type="button"
            className="mk1-btn"
            onClick={() => { setFlashFromBanner(false); setFlashOpen((o) => !o); }}
            aria-expanded={flashOpen}
          >
            <LuCpu size={17} /> firmware
          </button>
          {/* green once the card has said hello, not for a port that only opened */}
          <Status text={status} mode={mode === "card" && !card.live ? "wait" : mode} />
        </motion.div>

        <AnimatePresence initial={false}>
          {update && (
            <Unfold key="update">
              <UpdateBanner
                release={update.release}
                onCard={update.onCard}
                onOpen={() => { setFlashFromBanner(true); setFlashOpen(true); }}
                onDismiss={() => setSkipped(update.release.version)}
              />
            </Unfold>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {picking && firefox && (
            <Unfold key="gate">
              <p className="mk1-note">
                firefox may first offer a “site permission add-on”: that is how it lets a page reach usb. allow it,
                then pick the card.
              </p>
            </Unfold>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {trouble && (
            <Unfold key="help">
              <ConnectHelp trouble={trouble} os={os} onPick={() => connectCard(true)} />
            </Unfold>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {silent && (
            <Unfold key="silent">
              <NoAnswer onPick={() => connectCard(true)} />
            </Unfold>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {flashOpen && (
            <Unfold key="flash">
              <Flasher
                source={firmware}
                latest={latest}
                focusInstall={flashFromBanner}
                onCard={card.firmware}
                connected={mode === "card"}
                bootloader={toBootloader}
                usb={!usbTrouble()}
                serial={!away}
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
        <Fold open={!trouble} enter={3}>
          <TerminalNote trouble={away} os={os} />
        </Fold>

        <motion.footer className="mk1-foot" {...rise(4)}>
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
