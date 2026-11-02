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

const STEPS: Record<Desk, ReactNode> = {
  mac: (
    <ol>
      <li>plug the card in and open Terminal</li>
      <li>connect to it:<Copyable text={'screen "$(ls /dev/cu.usbmodem* | head -n 1)" 115200'} /></li>
      <li>to leave: <kbd>ctrl-a</kbd>, then <kbd>k</kbd>, then <kbd>y</kbd></li>
    </ol>
  ),
  linux: (
    <ol>
      <li>plug the card in and connect to it:<Copyable text="screen /dev/ttyACM0 115200" /></li>
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
        open <a href="https://www.chiark.greenend.org.uk/~sgtatham/putty/" target="_blank" rel="noreferrer">PuTTY</a>:
        connection type Serial, serial line <span className="mono">COM3</span>, speed <span className="mono">115200</span>,
        Open. With PuTTY's plink in a terminal:<Copyable text="plink -serial COM3 -sercfg 115200" />
      </li>
    </ol>
  ),
};

/** when the browser can't open the card, how to reach its shell from the visitor's own terminal */
export function ConnectHelp({ trouble, os }: { trouble: Trouble; os: Os }) {
  const [desk, setDesk] = useState<Desk>(deskOf(os));
  const phone = os === "ios" || os === "android";
  return (
    <section className="mc1-help card" aria-live="polite">
      <p className="mc1-help-lead">
        <LuCircleAlert size={18} />
        <span>
          {phone ? "a phone can't open the card's shell: plug the card into a computer. you can still try it here." : LEAD[trouble]}
        </span>
      </p>
      <div className="mc1-tabs" role="tablist" aria-label="your computer">
        {(Object.keys(NAMES) as Desk[]).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === desk} onClick={() => setDesk(d)}>
            {d === desk && <LuTerminal size={15} />}
            {NAMES[d]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mc1-steps">{STEPS[desk]}</div>
    </section>
  );
}
