import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EASE, Smooth, Swap, Unfold } from "../anim";
import { Copyable } from "../help/Copyable";
import type { Desk } from "../help/platform";
import { LuCheck, LuCircleAlert, LuCircleDot, LuCpu, LuDownload, LuFileUp, LuLoaderCircle, LuPlay, SiGithub } from "../icons";
import { Changelog } from "./Changelog";
import { Picoboot, RP2350_BOOT } from "./picoboot";
import { download, isNewer, latestRelease, releaseDay, type FirmwareSource, type Release } from "./releases";
import { MAX_UF2_BYTES, parseUf2, type Image } from "./uf2";
import "./flash.css";

export type Latest = { s: "loading" } | { s: "none" } | { s: "error"; m: string } | { s: "ok"; r: Release };

/** the latest release, asked for once as the page opens: the update banner wants it as soon as a card says hello */
export function useLatest(source: FirmwareSource): Latest {
  const [latest, setLatest] = useState<Latest>({ s: "loading" });
  useEffect(() => {
    let live = true;
    latestRelease(source)
      .then((r) => live && setLatest(r ? { s: "ok", r } : { s: "none" }))
      .catch((e: Error) => live && setLatest({ s: "error", m: e.message }));
    return () => { live = false; };
  }, [source.github]);
  return latest;
}

type Props = {
  source: FirmwareSource;
  latest: Latest;
  /** the connected card's firmware version, if it told us */
  onCard: string | null;
  connected: boolean;
  /** restarts the card into its bootloader without a hand on it, whether the terminal has it or it is only
   *  plugged in and was allowed before; false when the page can't reach it */
  bootloader(): Promise<string | null>;
  /** WebUSB works here */
  usb: boolean;
  /** Web Serial works here: a card the page can reach goes to its bootloader without a hand on it */
  serial: boolean;
  desk: Desk;
  onBusyChange(busy: boolean): void;
  /** opened from the update banner: the install button takes the keyboard */
  focusInstall?: boolean;
};

type Step = "fetch" | "boot" | "pick" | "confirm" | "write" | "done" | "fail" | "manual";
type Job = {
  label: string;
  /** from a release (else the visitor's own file), and whether the release had a sha256 to check it against */
  release: boolean;
  checked: boolean;
  file: Uint8Array | null;
  /** the flash the image takes */
  bytes: number;
  step: Step;
  progress: number;
  /** the write began: its bar stays, however it ends */
  wrote: boolean;
  error: string | null;
  page: string | null;
  /** the card's way to its bootloader: "now" while the page restarts it, "yes" once it is there (its RP2350
   *  drive is up, no unplugging) */
  boot: "no" | "now" | "yes";
  safeToCopy: boolean;
};

const UDEV = `echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="000f", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/60-mk1.rules && sudo udevadm control --reload-rules`;

type Mark = "now" | "done" | "fail" | "wait";
const MARKS: Record<Mark, ReactNode> = {
  now: <LuLoaderCircle className="mk1-spin" size={16} />,
  done: <LuCheck size={16} />,
  fail: <LuCircleAlert size={16} />,
  wait: <LuCircleDot size={16} />,
};

/** a step of the install: what the page is doing, did, or needs from the visitor, its mark turning as it goes.
 *  `id` names what the line says, so a new say fades in */
function Line({ mark, id, children }: { mark: Mark; id: string; children: ReactNode }) {
  return (
    <motion.li
      className="mk1-line"
      data-mark={mark}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.36, ease: EASE }}
    >
      <Swap id={mark}>{MARKS[mark]}</Swap>
      <motion.div key={id} className="mk1-line-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE }}>
        {children}
      </motion.div>
    </motion.li>
  );
}

/** the write: kilobytes and percent counting up with the bar, which eases between the sectors the bootloader
 *  confirms and stays when it ends (full, it turns green) */
function Progress({ value, bytes, mark }: { value: number; bytes: number; mark: Mark }) {
  const still = useReducedMotion();
  const shown = useMotionValue(value);
  useEffect(() => {
    if (still) return void shown.set(value);
    const run = animate(shown, value, { duration: 0.32, ease: EASE });
    return () => run.stop();
  }, [value, still, shown]);
  const width = useTransform(shown, (v) => `${v * 100}%`);
  const percent = useTransform(shown, (v) => `${Math.floor(v * 100)}%`);
  const kb = useTransform(shown, (v) => Math.round((v * bytes) / 1024));
  return (
    <>
      <span className="mk1-line-head">
        <span>{mark === "done" ? "written" : mark === "fail" ? "the write stopped" : "writing"}</span>
        {/* a screen reader gets the bar's own value: this counts every frame */}
        <span className="mono mk1-count" aria-hidden="true">
          <motion.span>{kb}</motion.span> of {Math.round(bytes / 1024)} KB · <motion.span>{percent}</motion.span>
        </span>
      </span>
      <div
        className="mk1-progress"
        data-mark={mark}
        role="progressbar"
        aria-label="writing the firmware"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <motion.div style={{ width }} />
      </div>
    </>
  );
}

function Failure({ job }: { job: Job }) {
  return (
    <>
      {job.error}
      {job.page && <> · <a href={job.page} target="_blank" rel="noreferrer">the release page</a></>}
    </>
  );
}

/** firmware like Flipper's: the latest release in one click, or a .uf2 of your own */
export function Flasher({ source, latest, onCard, connected, bootloader, usb, serial, desk, onBusyChange, focusInstall }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [over, setOver] = useState(false);
  const image = useRef<Image | null>(null);
  const expected = useRef<string | null>(null);
  const selected = useRef<USBDevice | null>(null);
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const installButton = useRef<HTMLButtonElement>(null);

  // the panel is still unfolding, clipped: scrolled to, the button would shift inside it
  useEffect(() => {
    if (focusInstall) installButton.current?.focus({ preventScroll: true });
  }, []);

  const patch = (p: Partial<Job>) => setJob((j) => (j ? { ...j, ...p } : j));
  const fail = (e: unknown) => patch({ step: "fail", error: e instanceof Error ? e.message : String(e) });
  async function exclusive(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    onBusyChange(true);
    try { await action(); }
    catch (error) { fail(error); }
    finally {
      operation.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function write(dev: USBDevice) {
    const firmware = image.current;
    if (!firmware) throw new Error("choose a firmware file first");
    patch({ step: "write", progress: 0, wrote: true });
    let pb: Picoboot | null = null;
    try {
      pb = await Picoboot.open(dev, expected.current);
      await pb.flash(firmware, (p) => patch({ progress: p }));
      patch({ step: "done" });
    } finally {
      await pb?.close();
    }
  }

  const install = (label: string, get: () => Promise<Uint8Array>, rel: Release | null) => exclusive(async () => {
    image.current = null;
    expected.current = null;
    selected.current = null;
    setJob({
      label, release: rel !== null, checked: !!rel?.sha256, file: null, bytes: 0, step: "fetch", progress: 0,
      wrote: false, error: null, page: rel?.page ?? null, boot: "no", safeToCopy: false,
    });
    const file = await get();
    const firmware = parseUf2(file);
    image.current = firmware;
    patch({ file, bytes: firmware.bytes, safeToCopy: firmware.safeToCopy });
    if (!usb && !firmware.safeToCopy) throw new Error("this uf2 could erase progress on the boot drive. use webusb or a newer release");
    if (serial) {
      patch({ step: "boot" });
      const shown = setTimeout(() => patch({ boot: "now" }), connected ? 0 : 200);
      try { expected.current = await bootloader(); }
      finally { clearTimeout(shown); }
    }
    patch({ step: usb ? "pick" : "manual", boot: expected.current ? "yes" : "no" });
  });

  const pick = () => exclusive(async () => {
    patch({ error: null });
    let device: USBDevice;
    try {
      device = await navigator.usb.requestDevice({ filters: [RP2350_BOOT] });
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return;
      throw e;
    }
    const chip = expected.current;
    if (chip && device.serialNumber?.toLowerCase() !== chip) {
      return patch({ step: "pick", error: "this bootloader belongs to a different board. select the card you restarted" });
    }
    selected.current = device;
    if (chip) await write(device);
    else patch({ step: "confirm" });
  });

  const confirm = () => exclusive(async () => {
    const device = selected.current;
    if (!device) throw new Error("pick the card's bootloader first");
    await write(device);
  });

  const file = job?.safeToCopy ? job.file : null;
  const fileUrl = useMemo(
    () => (file ? URL.createObjectURL(new Blob([file.slice().buffer], { type: "application/octet-stream" })) : null),
    [file],
  );
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const fromFile = (f: File | undefined) => {
    if (f) install(f.name, async () => {
      if (f.size > MAX_UF2_BYTES) throw new Error("the firmware file is too large");
      return new Uint8Array(await f.arrayBuffer());
    }, null);
  };

  // while an install has the card in its bootloader it is off the serial port, not gone: it still runs what it said
  const [seen, setSeen] = useState(onCard);
  if (onCard && onCard !== seen) setSeen(onCard);
  const card = onCard ?? (busy ? seen : null);
  const rel = latest.s === "ok" ? latest.r : null;
  const demo = rel?.demo;
  const newer = rel ? isNewer(rel.version, card) : false;
  const same = rel !== null && rel.version === card;

  const lines: ReactNode[] = [];
  if (job) {
    const fetched = job.file !== null;
    const failed = job.step === "fail";
    lines.push(
      fetched ? (
        <Line key="get" mark="done" id="got">
          {job.release ? (job.checked ? "downloaded, the checksum matches" : "downloaded") : "read the file"}
        </Line>
      ) : failed ? (
        <Line key="get" mark="fail" id="lost"><Failure job={job} /></Line>
      ) : (
        <Line key="get" mark="now" id="getting">{job.release ? "downloading the firmware" : "reading the file"}</Line>
      ),
    );
    // the restart isn't over at the 1200-baud touch: the step lasts until the bootloader is up on usb
    if (job.boot !== "no") {
      const booting = job.step === "boot";
      lines.push(
        <Line key="boot" mark={booting ? "now" : "done"} id={booting ? "booting" : "booted"}>
          {booting ? "restarting the card into its bootloader" : "bootloader restart requested for the connected card"}
        </Line>,
      );
    }
    if (job.step === "pick")
      lines.push(
        <Line key="pick" mark="wait" id="pick">
          <div className="mk1-job-pick">
            <p>
              {job.boot === "yes"
                ? "pick the connected card's bootloader in the browser."
                : "disconnect the other rp2350 boards. hold the card's button while plugging it in, then choose its bootloader."}
            </p>
            {job.error && <p role="alert">{job.error}</p>}
            <button type="button" className="mk1-btn primary" disabled={busy} onClick={pick}>pick the bootloader</button>
            {desk === "linux" && (
              <div className="mk1-job-note">
                not in the list? let the browser reach it, then plug the card in again:<Copyable text={UDEV} />
              </div>
            )}
          </div>
        </Line>,
      );
    if (job.step === "confirm") {
      lines.push(
        <Line key="confirm" mark="wait" id="confirm">
          <div className="mk1-job-pick">
            <p>confirm this is the only rp2350 board connected and you put it into bootsel.</p>
            <button type="button" className="mk1-btn primary" disabled={busy} onClick={confirm}>write to selected device</button>
          </div>
        </Line>,
      );
    }
    if (job.wrote) {
      const mark = job.step === "done" ? "done" : failed ? "fail" : "now";
      lines.push(
        <Line key="write" mark={mark} id="write">
          <Progress value={job.progress} bytes={job.bytes} mark={mark} />
        </Line>,
      );
    }
    if (job.step === "done")
      lines.push(
        <Line key="end" mark="done" id="restart">
          firmware verified and restart requested. reconnect the card to check its version.
        </Line>,
      );
    if (failed && fetched) lines.push(<Line key="fail" mark="fail" id="fail"><Failure job={job} /></Line>);
    if (job.safeToCopy && (job.step === "manual" || (failed && fetched)))
      lines.push(
        <Line key="manual" mark="wait" id="manual">
          <ol className="mk1-manual">
            <li>
              {fileUrl && <a href={fileUrl} download={job.label.endsWith(".uf2") ? job.label : `mk1-${job.label}.uf2`}>save the .uf2</a>}
              {fileUrl ? " (if you don't have it yet)" : ""}
            </li>
            <li>
              {job.boot === "yes" ? "the card has restarted into its bootloader" : "unplug the card, hold its button and plug it back in"}:
              a drive called <span className="mono">RP2350</span> shows up
            </li>
            <li>drop the .uf2 onto it. the card restarts with the new firmware by itself</li>
          </ol>
          {/* the restart was asked for, not seen: a card that didn't take it still needs the hand */}
          {job.boot === "yes" && <p className="mk1-job-note">no drive? unplug the card, hold its button and plug it back in.</p>}
        </Line>,
      );
  }

  return (
    <section className="mk1-flash card" aria-labelledby="mk1-flash-title">
      <div className="mk1-flash-head">
        <h2 className="eyebrow" id="mk1-flash-title"><LuCpu size={17} /> firmware</h2>
        {source.github && (
          <a className="mk1-flash-src" href={`https://github.com/${source.github}`} target="_blank" rel="noreferrer">
            <SiGithub size={14} /> {source.github}
          </a>
        )}
      </div>

      <div className="mk1-release">
        <Smooth>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={latest.s}
              className="mk1-release-row"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              {latest.s === "loading" && <p className="mk1-quiet"><LuLoaderCircle className="mk1-spin" size={16} /> looking for the latest release</p>}
              {latest.s === "none" && <p className="mk1-quiet">no firmware released yet. a .uf2 of your own still goes in below.</p>}
              {latest.s === "error" && <p className="mk1-quiet">the latest release didn't load: {latest.m}</p>}
              {rel && (
                <>
                  <div>
                    <p className="mk1-release-name">
                      latest release{" "}
                      <span className="mono">{rel.version}</span>
                      {releaseDay(rel.date) && <span className="mk1-release-day"> · {releaseDay(rel.date)}</span>}
                    </p>
                    <p className="mk1-release-card">
                      {card === null ? "connect the card to compare"
                        : same ? "the card runs this version"
                        : <>the card runs <span className="mono">{card}</span>{newer ? "" : ", a newer one"}</>}
                    </p>
                  </div>
                  <button
                    ref={installButton}
                    type="button"
                    className={newer ? "mk1-btn primary" : "mk1-btn"}
                    disabled={busy}
                    onClick={() => install(rel.version, () => download(rel), rel)}
                  >
                    <LuDownload size={17} /> install
                  </button>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </Smooth>
        {rel && (
          <Changelog
            key={rel.version}
            release={rel}
            demoAction={demo && (
              <button
                type="button"
                className="mk1-flash-src mk1-release-demo"
                disabled={busy}
                onClick={() => install(`mk1-demo-${rel.version}.uf2`, () => download({ ...demo, page: rel.page }), rel)}
              >
                <LuPlay size={13} aria-hidden="true" /> load a demo
              </button>
            )}
          />
        )}
      </div>

      <div
        className="mk1-drop"
        data-over={over || undefined}
        data-busy={busy || undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) fromFile(e.dataTransfer.files[0]); }}
      >
        <LuFileUp size={20} />
        <p>
          your own firmware: drop a <span className="mono">.uf2</span> here or{" "}
          <button type="button" className="mk1-link" disabled={busy} onClick={() => picker.current?.click()}>choose a file</button>
        </p>
        <input ref={picker} type="file" accept=".uf2" hidden disabled={busy} onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <AnimatePresence initial={false}>
        {job && (
          <Unfold key="job" gap={18}>
            <div className="mk1-job" aria-live="polite">
              <p className="mk1-job-title">installing <span className="mono">{job.label}</span></p>
              <Smooth>
                <ol className="mk1-log">
                  <AnimatePresence initial={false}>{lines}</AnimatePresence>
                </ol>
              </Smooth>
            </div>
          </Unfold>
        )}
      </AnimatePresence>
    </section>
  );
}
