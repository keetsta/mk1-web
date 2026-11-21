import { useState, type ReactNode } from "react";
import { LuCheck, LuCircleAlert, LuShare, LuTerminal, LuUsb } from "../icons";
import type { Trouble } from "../serial/link";
import { Copyable } from "./Copyable";
import { deskOf, isFirefox, type Desk, type Os } from "./platform";
import "./help.css";

const LEAD: Record<Trouble, string> = {
  unsupported: "this browser can't reach usb devices. chrome, edge and firefox on a computer can, or open the shell from a terminal:",
  insecure: "usb only works on a secure page (https). open the shell from a terminal instead:",
  blocked: "usb is blocked on this page. open the shell from a terminal instead:",
  busy: "the card's port wouldn't open. another app may be holding it (close screen or the other tab), or open it from a terminal:",
  lost: "the card went away. plug it back in and connect again, or use a terminal:",
};
const LEAD_FIREFOX = "firefox reaches usb devices from version 151 on: update it, or open the shell from a terminal:";
const LEAD_PHONE = "a phone or tablet can't open the card's shell: plug the card into a computer. you can still try it here.";

const NAMES: Record<Desk, string> = { mac: "macOS", linux: "Linux", windows: "Windows" };

// 115200 like any serial console: at 1200 baud the firmware restarts the card into its bootloader
const SCREEN = {
  mac: 'screen "$(ls /dev/cu.usbmodem* | head -n 1)" 115200',
  linux: "screen /dev/ttyACM0 115200",
};
const PUTTY = "https://www.chiark.greenend.org.uk/~sgtatham/putty/";

const STEPS: Record<Desk, ReactNode> = {
  mac: (
    <ol>
      <li>plug the card in and open Terminal</li>
      <li>connect to it:<Copyable text={SCREEN.mac} /></li>
      <li>to leave: <kbd>ctrl-a</kbd>, then <kbd>k</kbd>, then <kbd>y</kbd></li>
    </ol>
  ),
  linux: (
    <ol>
      <li>plug the card in and connect to it:<Copyable text={SCREEN.linux} /></li>
      <li>
        permission denied? let your user open serial ports, then log out and back in (the group is <span className="mono">uucp</span> on
        Arch):<Copyable text={'sudo usermod -aG dialout "$USER"'} />
      </li>
      <li>to leave: <kbd>ctrl-a</kbd>, then <kbd>k</kbd></li>
    </ol>
  ),
  windows: (
    <ol>
      <li>
        plug the card in and find its port in PowerShell (or in Device Manager, under Ports: “USB Serial Device
        (COM3)”):<Copyable text="[System.IO.Ports.SerialPort]::GetPortNames()" />
      </li>
      <li>
        open <a href={PUTTY} target="_blank" rel="noreferrer">PuTTY</a>:
        connection type Serial, serial line <span className="mono">COM3</span>, speed <span className="mono">115200</span>,
        Open. With PuTTY's plink in a terminal:<Copyable text="plink -serial COM3 -sercfg 115200" />
      </li>
    </ol>
  ),
};

const isPhone = (os: Os) => os === "ios" || os === "android";

/** on a phone the card has to go to a computer, and so does the page: the share sheet (AirDrop, a message to
 *  oneself), or the link copied where there is none */
function SendOn() {
  const [copied, setCopied] = useState(false);
  const send = async () => {
    const url = location.origin + location.pathname;
    if (typeof navigator.share === "function") {
      await navigator.share({ title: document.title, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* the address bar still has it */ }
  };
  return (
    <button type="button" className="mk1-send" onClick={send}>
      {copied ? <LuCheck size={15} /> : <LuShare size={15} />}
      {copied ? "link copied" : "send this page to your computer"}
    </button>
  );
}

/** when the browser can't open the card, how to reach its shell from the visitor's own terminal. a busy port
 *  may be the one card the site knows while the visitor plugged in a second: onPick opens the list for it */
export function ConnectHelp({ trouble, os, onPick }: { trouble: Trouble; os: Os; onPick(): void }) {
  const [desk, setDesk] = useState<Desk>(deskOf(os));
  const phone = isPhone(os);
  const lead = phone ? LEAD_PHONE : trouble === "unsupported" && isFirefox() ? LEAD_FIREFOX : LEAD[trouble];
  return (
    <section className="mk1-help card" aria-live="polite">
      <p className="mk1-help-lead">
        <LuCircleAlert size={18} />
        <span>{lead}</span>
      </p>
      {phone && <SendOn />}
      {trouble === "busy" && (
        <button type="button" className="mk1-btn" onClick={onPick}><LuUsb size={17} /> pick another port</button>
      )}
      <div className="mk1-tabs" role="tablist" aria-label="your computer">
        {(Object.keys(NAMES) as Desk[]).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === desk} onClick={() => setDesk(d)}>
            {d === desk && <LuTerminal size={15} />}
            {NAMES[d]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mk1-steps">{STEPS[desk]}</div>
    </section>
  );
}

/** the port opened and stayed quiet: another board on Raspberry Pi's vendor id, or a card on firmware that
 *  doesn't speak to the page. its terminal is there all the same */
export function NoAnswer({ onPick }: { onPick(): void }) {
  return (
    <section className="mk1-help card" aria-live="polite">
      <p className="mk1-help-lead">
        <LuCircleAlert size={18} />
        <span>
          no answer from the card: this may be another board, or a card on other firmware. the terminal below still
          works, the card above stays dark.
        </span>
      </p>
      <button type="button" className="mk1-btn" onClick={onPick}><LuUsb size={17} /> pick another port</button>
    </section>
  );
}

/** what keeps this browser from the card from the start, said before anyone presses connect */
const AWAY: Partial<Record<Trouble, string>> = {
  unsupported: "this browser can't reach usb. chrome, edge and firefox can, and so can a terminal:",
  insecure: "usb only works on a secure page (https). a terminal works anywhere:",
};
const AWAY_FIREFOX = "this firefox is too old for usb: 151 and newer can, and so can a terminal:";
// on an iPhone every browser is Safari underneath, chrome, edge and firefox included: none of them reaches usb
const AWAY_PHONE = "a phone or tablet can't reach the card. on a computer chrome, edge and firefox can, and so can a terminal:";

/** a footnote to "connect the card", for every visitor: the card is a plain usb serial port, so any terminal
 *  opens its shell. one line; the help panel has the long way. the plain glob is enough here, the panel's
 *  command also copes with two usbmodem ports */
export function TerminalNote({ trouble, os }: { trouble: Trouble | null; os: Os }) {
  const phone = isPhone(os) && trouble !== null;
  const lead =
    trouble === "unsupported" ? (phone ? AWAY_PHONE : isFirefox() ? AWAY_FIREFOX : AWAY.unsupported) : trouble && AWAY[trouble];
  return (
    <p className="mk1-note">
      <span>{lead || "or from a terminal:"}</span>
      <span>{NAMES.mac} <code className="mono">screen /dev/cu.usbmodem* 115200</code></span>
      <span>{NAMES.linux} <code className="mono">{SCREEN.linux}</code></span>
      <span>
        {NAMES.windows} <a href={PUTTY} target="_blank" rel="noreferrer">PuTTY</a>, Serial, COM port
      </span>
      {phone && <SendOn />}
    </p>
  );
}
