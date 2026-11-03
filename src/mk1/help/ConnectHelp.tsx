import { useState, type ReactNode } from "react";
import { LuCircleAlert, LuTerminal } from "../icons";
import type { Trouble } from "../serial/link";
import { Copyable } from "./Copyable";
import { deskOf, type Desk, type Os } from "./platform";
import "./help.css";

const LEAD: Record<Trouble, string> = {
  unsupported: "this browser can't reach usb devices. chrome or edge on a computer can, or open the shell from a terminal:",
  insecure: "usb only works on a secure page (https). open the shell from a terminal instead:",
  blocked: "usb is blocked on this page. open the shell from a terminal instead:",
  busy: "the card's port wouldn't open. another app may be holding it (close screen or the other tab), or open it from a terminal:",
  lost: "the card went away. plug it back in and connect again, or use a terminal:",
};

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

/** when the browser can't open the card, how to reach its shell from the visitor's own terminal */
export function ConnectHelp({ trouble, os }: { trouble: Trouble; os: Os }) {
  const [desk, setDesk] = useState<Desk>(deskOf(os));
  return (
    <section className="mk1-help card" aria-live="polite">
      <p className="mk1-help-lead">
        <LuCircleAlert size={18} />
        <span>
          {isPhone(os) ? "a phone or tablet can't open the card's shell: plug the card into a computer. you can still try it here." : LEAD[trouble]}
        </span>
      </p>
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

/** what keeps this browser from the card from the start, said before anyone presses connect */
const AWAY: Partial<Record<Trouble, string>> = {
  unsupported: "this browser can't reach usb. chrome and edge can, and so can a terminal:",
  insecure: "usb only works on a secure page (https). a terminal works anywhere:",
};
// on an iPhone every browser is Safari underneath, chrome and edge included: none of them reaches usb
const AWAY_PHONE = "a phone or tablet can't reach the card. on a computer chrome and edge can, and so can a terminal:";

const isPhone = (os: Os) => os === "ios" || os === "android";

/** a footnote to "connect the card", for every visitor: the card is a plain usb serial port, so any terminal
 *  opens its shell. one line; the help panel has the long way. the plain glob is enough here, the panel's
 *  command also copes with two usbmodem ports */
export function TerminalNote({ trouble, os }: { trouble: Trouble | null; os: Os }) {
  const lead = trouble === "unsupported" && isPhone(os) ? AWAY_PHONE : trouble && AWAY[trouble];
  return (
    <p className="mk1-note">
      <span>{lead || "or from a terminal:"}</span>
      <span>{NAMES.mac} <code className="mono">screen /dev/cu.usbmodem* 115200</code></span>
      <span>{NAMES.linux} <code className="mono">{SCREEN.linux}</code></span>
      <span>
        {NAMES.windows} <a href={PUTTY} target="_blank" rel="noreferrer">PuTTY</a>, Serial, COM port
      </span>
    </p>
  );
}
