import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuzzer } from "./buzzer";
import { Flasher } from "./flash/Flasher";
import type { FirmwareSource } from "./flash/releases";
import { ConnectHelp } from "./help/ConnectHelp";
import { deskOf, detectOs, usbTrouble } from "./help/platform";
import { LuCpu, LuLoaderCircle, LuPlay, LuSun, LuUnplug, LuUsb, LuVolume2, LuVolumeX } from "./icons";
import { CardPreview } from "./preview/CardPreview";
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
const blank = () => new Uint16Array(9);

/** keetsta.me/mk1: the card's shell over USB, its firmware, and the same shell running right here */
export function Mk1({ firmware = DEFAULT_FIRMWARE }: { firmware?: FirmwareSource }) {
  const os = useMemo(detectOs, []);
  const [mode, setMode] = useState<Mode>("idle");
  const [rows, setRows] = useState<Uint16Array>(blank);
  const [hz, setHz] = useState(0);
  const [card, setCard] = useState<{ live: boolean; firmware: string | null }>({ live: false, firmware: null });
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [lux, setLux] = useState(512);
  const [sound, setSound] = useState(true);
  const [running, setRunning] = useState(false);

  const term = useRef<TermHandle>(null);
  const shell = useRef<Shell | null>(null);
  const link = useRef<CardLink | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const inputs = useRef({ pressed, lux });
  inputs.current = { pressed, lux };
  const tryFrame = useRef<{ rows: Uint16Array; hz: number }>({ rows: blank(), hz: 0 });
  const reconnect = useRef(false);

  useBuzzer(hz, sound && mode === "try");

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
    await closeCard();
    term.current?.clear();
    setRows(tryFrame.current.rows);
    setHz(tryFrame.current.hz);
    setMode("try");
    if (shell.current) {
      shell.current.input(Uint8Array.of(13)); // back to a fresh prompt
    } else {
      try {
        shell.current = await loadShell({
          write: (b) => term.current?.write(b),
          frame: (r, f) => {
            tryFrame.current = { rows: r, hz: f };
            if (modeRef.current === "try") {
              setRows(r);
              setHz(f);
            }
          },
          button: () => inputs.current.pressed,
          lux: () => inputs.current.lux,
          load: loadState,
          save: saveState,
          exit: () => {},
        });
      } catch (e) {
        term.current?.write(`\r\n${e instanceof Error ? e.message : e}\r\n`);
        setMode("idle");
        return;
      }
    }
    term.current?.focus();
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
    setConnecting(true);
    try {
      await closeCard();
      const l = await openCard(port, {
        text: (b) => term.current?.write(b),
        message: (m) => {
          if (m.kind === "hello") setCard({ live: true, firmware: m.firmware });
          else {
            setRows(m.rows);
            setHz(m.hz);
          }
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
      setHz(0);
      setMode("card");
      term.current?.write("\x1b[2m(the card is on. press enter for its prompt)\x1b[0m\r\n");
      term.current?.focus();
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

  useEffect(() => {
    term.current?.write("\x1b[2mthe card's shell shows up here: connect the card, or try it right here.\x1b[0m");
    return () => { link.current?.close(); };
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
    : mode === "card" ? (card.live ? `card on usb · firmware ${card.firmware ?? "----"}` : "card on usb")
    : connecting ? "connecting"
    : "nothing connected";

  return (
    <section className="mk1">
      <header className="mk1-head">
        <h1>mk-1</h1>
        <p>
          a business card with a shell. plug it in over usb-c and write code for a chip that doesn't exist: it lights
          the card's real leds. no card at hand? the same shell runs right here.
        </p>
      </header>

      <div className="mk1-stage">
        <CardPreview rows={rows} pressable={mode === "try"} pressed={pressed} onPress={setPressed} />
        {mode === "try" && (
          <div className="mk1-controls">
            <label className="mk1-light">
              <LuSun size={17} />
              <span>light</span>
              <input type="range" min={0} max={1023} step={1} value={lux} onChange={(e) => setLux(Number(e.target.value))} />
              <span className="mono mk1-light-value">{lux}</span>
            </label>
            <button type="button" className="mk1-icon-btn" onClick={() => setSound((s) => !s)} aria-label={sound ? "mute the buzzer" : "unmute the buzzer"} aria-pressed={!sound}>
              {sound ? <LuVolume2 size={18} /> : <LuVolumeX size={18} />}
            </button>
            <p className="mk1-hint">
              {running ? "space holds the card's button, + and − change the light" : "the card's button works too: press it"}
            </p>
          </div>
        )}
      </div>

      <div className="mk1-actions">
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
        <span className="mk1-pill mk1-status" data-mode={mode}>{status}</span>
      </div>

      {trouble && <ConnectHelp trouble={trouble} os={os} />}

      {flashOpen && (
        <Flasher
          source={firmware}
          onCard={card.firmware}
          connected={mode === "card"}
          bootloader={async () => { reconnect.current = true; await link.current?.bootloader(); }}
          usb={!usbTrouble()}
          desk={deskOf(os)}
          onFlashed={() => { reconnect.current = true; }}
        />
      )}

      <div className="card mk1-term-card">
        <Term ref={term} onData={onData} onKey={onKey} label="the card's shell" />
      </div>
    </section>
  );
}
