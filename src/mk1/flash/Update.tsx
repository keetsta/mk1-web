import { motion } from "motion/react";
import { EASE } from "../anim";
import { LuArrowUp, LuX } from "../icons";
import { releaseDay, type Release } from "./releases";
import "./flash.css";

type Props = {
  release: Release;
  /** the version the connected card said it runs */
  onCard: string;
  /** opens the firmware panel, its install button ready */
  onOpen(): void;
  onDismiss(): void;
};

/** a release newer than the connected card's firmware: what it is, and one click to the panel that installs it */
export function UpdateBanner({ release, onCard, onOpen, onDismiss }: Props) {
  const day = releaseDay(release.date);
  return (
    <section className="mk1-update card" role="status" aria-label="firmware update">
      <span className="mk1-update-icon" aria-hidden="true">
        <motion.span initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.6, ease: EASE }}>
          <LuArrowUp size={18} />
        </motion.span>
      </span>
      <p className="mk1-update-text">
        <span className="mk1-update-title">firmware <span className="mono">{release.version}</span> is out</span>
        <span className="mk1-update-sub">
          the card runs <span className="mono">{onCard}</span>
          {day && <> · released {day}</>}
        </span>
      </p>
      <div className="mk1-update-do">
        <button type="button" className="mk1-btn primary" onClick={onOpen}>update</button>
        <button type="button" className="mk1-update-x" onClick={onDismiss} aria-label="not now" title="not now">
          <LuX size={17} />
        </button>
      </div>
    </section>
  );
}
