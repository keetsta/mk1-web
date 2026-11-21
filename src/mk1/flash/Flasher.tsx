import { useEffect, useMemo, useRef, useState } from "react";
import type { Desk } from "../help/platform";
import { Copyable } from "../help/Copyable";
import { LuCheck, LuCircleAlert, LuCpu, LuFileUp, LuLoaderCircle, SiGithub } from "../icons";
import { Picoboot, RP2350_BOOT } from "./picoboot";
import { compareVersions, download, latestRelease, type FirmwareSource, type Release } from "./releases";
import { parseUf2, type Image } from "./uf2";
import "./flash.css";

type Props = {
  source: FirmwareSource;
  /** the connected card's firmware version, if it told us */
  onCard: string | null;
  connected: boolean;
  /** restarts the connected card into its bootloader */
  bootloader(): Promise<void>;
  /** WebUSB works here */
  usb: boolean;
  desk: Desk;
  /** the card is writing its new firmware and will come back over USB */
  onFlashed(): void;
};

type Step = "fetch" | "boot" | "pick" | "write" | "done" | "fail" | "manual";
type Job = { label: string; file: Uint8Array | null; step: Step; progress: number; error: string | null; page: string | null };
type Latest = { s: "loading" } | { s: "none" } | { s: "error"; m: string } | { s: "ok"; r: Release };

const UDEV = `echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="2e8a", ATTRS{idProduct}=="000f", MODE="0666"' | sudo tee /etc/udev/rules.d/60-mk1.rules && sudo udevadm control --reload-rules`;

async function bootDevice(): Promise<USBDevice | null> {
  const all = await navigator.usb.getDevices();
  return all.find((d) => d.vendorId === RP2350_BOOT.vendorId && d.productId === RP2350_BOOT.productId) ?? null;
}

async function waitBootDevice(ms: number): Promise<USBDevice | null> {
  for (let t = 0; t < ms; t += 250) {
    const d = await bootDevice();
    if (d) return d;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toLowerCase() : null;

/** firmware like Flipper's: the latest release in one click, or a .uf2 of your own */
export function Flasher({ source, onCard, connected, bootloader, usb, desk, onFlashed }: Props) {
  const [latest, setLatest] = useState<Latest>({ s: "loading" });
  const [job, setJob] = useState<Job | null>(null);
  const [over, setOver] = useState(false);
  const image = useRef<Image | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = job !== null && (job.step === "fetch" || job.step === "boot" || job.step === "write");

  useEffect(() => {
    let live = true;
    latestRelease(source)
      .then((r) => live && setLatest(r ? { s: "ok", r } : { s: "none" }))
      .catch((e: Error) => live && setLatest({ s: "error", m: e.message }));
    return () => { live = false; };
  }, [source.manifest, source.github]);

  const patch = (p: Partial<Job>) => setJob((j) => (j ? { ...j, ...p } : j));
  const fail = (e: unknown) => patch({ step: "fail", error: e instanceof Error ? e.message : String(e) });

  async function write(dev: USBDevice) {
    patch({ step: "write", progress: 0 });
    let pb: Picoboot | null = null;
    try {
      pb = await Picoboot.open(dev);
      await pb.flash(image.current!, (p) => patch({ progress: p }));
      patch({ step: "done" });
      onFlashed();
    } catch (e) {
      fail(e);
    } finally {
      await pb?.close();
    }
  }

  async function install(label: string, get: () => Promise<Uint8Array>, page: string | null) {
    setJob({ label, file: null, step: "fetch", progress: 0, error: null, page });
    try {
      const file = await get();
      image.current = parseUf2(file);
      patch({ file });
    } catch (e) {
      return fail(e);
    }
    if (!usb) return patch({ step: "manual" });
    const ready = await bootDevice();
    if (ready) return write(ready);
    if (connected) {
      patch({ step: "boot" });
      await bootloader().catch(() => {});
      const back = await waitBootDevice(4000);
      if (back) return write(back);
    }
    patch({ step: "pick" });
  }

  async function pick() {
    try {
      write(await navigator.usb.requestDevice({ filters: [RP2350_BOOT] }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) fail(e);
    }
  }

  const file = job?.file ?? null;
  const fileUrl = useMemo(
    () => (file ? URL.createObjectURL(new Blob([file.slice().buffer], { type: "application/octet-stream" })) : null),
    [file],
  );
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const fromFile = (f: File | undefined) => {
    if (f) install(f.name, async () => new Uint8Array(await f.arrayBuffer()), null);
  };

  const rel = latest.s === "ok" ? latest.r : null;
  const newer = rel && onCard ? compareVersions(rel.version, onCard) > 0 : false;

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
        {latest.s === "loading" && <p className="mk1-quiet"><LuLoaderCircle className="mk1-spin" size={16} /> looking for the latest release</p>}
        {latest.s === "none" && <p className="mk1-quiet">no firmware released yet. a .uf2 of your own still goes in below.</p>}
        {latest.s === "error" && <p className="mk1-quiet">the latest release didn't load: {latest.m}</p>}
        {rel && (
          <>
            <div>
              <p className="mk1-release-name">
                latest release{" "}
                {rel.page ? (
                  <a className="mono mk1-link" href={rel.page} target="_blank" rel="noreferrer">{rel.version}</a>
                ) : (
                  <span className="mono">{rel.version}</span>
                )}
                {day(rel.date) && <span className="mk1-quiet"> · {day(rel.date)}</span>}
              </p>
              <p className="mk1-quiet">
                {onCard === null ? "connect the card to compare" : newer ? "newer than the card's" : "the card has it"}
              </p>
            </div>
            <button
              type="button"
              className={newer ? "mk1-btn primary" : "mk1-btn"}
              disabled={busy}
              onClick={() => install(rel.version, () => download(rel), rel.page)}
            >
              {onCard !== null && !newer ? "install again" : "install"}
            </button>
          </>
        )}
      </div>

      <div
        className="mk1-drop"
        data-over={over || undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) fromFile(e.dataTransfer.files[0]); }}
      >
        <LuFileUp size={20} />
        <p>
          your own firmware: drop a <span className="mono">.uf2</span> here or{" "}
          <button type="button" className="mk1-link" disabled={busy} onClick={() => picker.current?.click()}>choose a file</button>
        </p>
        <input ref={picker} type="file" accept=".uf2" hidden onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {job && (
        <div className="mk1-job" aria-live="polite">
          <p className="mk1-job-title">installing <span className="mono">{job.label}</span></p>
          {job.step === "fetch" && <p className="mk1-quiet"><LuLoaderCircle className="mk1-spin" size={16} /> getting the firmware</p>}
          {job.step === "boot" && <p className="mk1-quiet"><LuLoaderCircle className="mk1-spin" size={16} /> restarting the card into its bootloader</p>}
          {job.step === "pick" && (
            <div className="mk1-job-pick">
              <p>
                {connected
                  ? "the card restarted into its bootloader. pick it in the browser's list: “RP2350 Boot”."
                  : "unplug the card, hold its button and plug it back in, then pick “RP2350 Boot” in the browser's list."}
              </p>
              <button type="button" className="mk1-btn primary" onClick={pick}>pick the bootloader</button>
              {desk === "linux" && (
                <p className="mk1-quiet">
                  not in the list? let the browser reach it, then plug the card in again:<Copyable text={UDEV} />
                </p>
              )}
            </div>
          )}
          {job.step === "write" && (
            <div className="mk1-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
              <div style={{ transform: `scaleX(${job.progress})` }} />
              <span className="mono">{Math.round(job.progress * 100)}%</span>
            </div>
          )}
          {job.step === "done" && <p className="mk1-ok"><LuCheck size={17} /> done. the card restarts with the new firmware.</p>}
          {job.step === "fail" && (
            <p className="mk1-bad">
              <LuCircleAlert size={17} /> {job.error}
              {job.page && <> · <a href={job.page} target="_blank" rel="noreferrer">the release page</a></>}
            </p>
          )}
          {(job.step === "manual" || job.step === "fail") && job.file && (
            <ol className="mk1-manual">
              <li>{fileUrl && <a href={fileUrl} download={job.label.endsWith(".uf2") ? job.label : `mk1-${job.label}.uf2`}>save the .uf2</a>}{fileUrl ? " (if you don't have it yet)" : ""}</li>
              <li>unplug the card, hold its button and plug it back in: a drive called <span className="mono">RP2350</span> shows up</li>
              <li>drop the .uf2 onto it. the card restarts with the new firmware by itself</li>
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
