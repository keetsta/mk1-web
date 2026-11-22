import { AnimatePresence } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { Unfold } from "../anim";
import { LuArrowUpRight, LuChevronDown } from "../icons";
import type { Release } from "./releases";

export function Changelog({ release, demoAction }: { release: Release; demoAction?: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { notes, page } = release;

  return (
    <div className="mk1-release-notes">
      <div className="mk1-release-notes-head">
        <button
          type="button"
          id={`${id}-toggle`}
          className="mk1-release-notes-toggle"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          changelog <LuChevronDown size={16} aria-hidden="true" />
        </button>
        {demoAction}
        {page && (
          <a className="mk1-flash-src mk1-release-page" href={page} target="_blank" rel="noreferrer">
            {notes?.truncated ? "full notes on GitHub" : "GitHub release"} <LuArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <Unfold gap={0}>
            <div id={id} className="mk1-release-notes-body" role="region" aria-labelledby={`${id}-toggle`}>
              {notes ? <ul>{notes.lines.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p>no notes for this release.</p>}
            </div>
          </Unfold>
        )}
      </AnimatePresence>
    </div>
  );
}
