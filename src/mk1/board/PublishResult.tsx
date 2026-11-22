import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type FormEvent } from "react";
import { EASE, Smooth, Swap } from "../anim";
import { LuArrowUp, LuCheck, LuCircleAlert, LuLoaderCircle } from "../icons";
import { boardNumber, boardUnavailable, publishBoardResult, type BoardEntry } from "./api";
import "../top.css";

const STATUS = {
  ready: { label: "result ready", icon: <LuArrowUp size={20} /> },
  sending: { label: "verifying result", icon: <LuLoaderCircle className="mk1-spin" size={20} /> },
  published: { label: "result published", icon: <LuCheck size={20} /> },
  failed: { label: "publication failed", icon: <LuCircleAlert size={20} /> },
};
const settle = { duration: 0.32, ease: EASE };

function ResultStats({ entry }: { entry: BoardEntry }) {
  const stats = [
    ["score", entry.score],
    ["solved", entry.solved],
    ["instructions", entry.instructions],
    ["cycles", entry.cycles],
  ] as const;
  return (
    <dl className="mk1-publish-stats">
      {stats.map(([label, value], index) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...settle, delay: 0.07 + index * 0.04 }}
        >
          <dt>{label}</dt>
          <dd className="mono">{boardNumber.format(value)}</dd>
        </motion.div>
      ))}
    </dl>
  );
}

export function PublishResult({ token, onPublished, embedded = false }: {
  token: string;
  onPublished?: (entry: BoardEntry) => void;
  embedded?: boolean;
}) {
  const errorId = useId();
  const [nickname, setNickname] = useState("");
  const [posting, setPosting] = useState(false);
  const [entry, setEntry] = useState<BoardEntry | null>(null);
  const [error, setError] = useState("");
  const name = nickname.trim().normalize("NFC");
  const nameError = [...name].length > 24 ? "keep your nickname to 24 characters." : "";
  const phase = entry ? "published" : posting ? "sending" : error ? "failed" : "ready";
  const status = STATUS[phase];

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (posting || nameError) return;
    setPosting(true);
    setError("");
    try {
      const published = await publishBoardResult(token, name || undefined);
      setEntry(published);
      onPublished?.(published);
    } catch (error) {
      const message = error instanceof Error ? error.message : boardUnavailable;
      setError(message === "invalid token" ? "copy the complete result link from top and try again." : message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className={embedded ? "mk1-publish-panel" : "card mk1-publish-panel"} data-phase={phase} aria-label="publish result">
      <header className="mk1-publish-head">
        <motion.span
          className="mk1-publish-mark"
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...settle, delay: 0.06 }}
        >
          <Swap id={phase}>{status.icon}</Swap>
        </motion.span>
        <div className="mk1-publish-status" role="status">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.11 } }}
              transition={settle}
            >
              <strong>{status.label}</strong>
              {entry && <bdi>{entry.nickname || entry.card}</bdi>}
            </motion.div>
          </AnimatePresence>
        </div>
        {entry && !onPublished && (
          <motion.a
            className="mk1-btn mk1-publish-board"
            href="/mk1/top/"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={settle}
          >
            view leaderboard
          </motion.a>
        )}
      </header>
      <div className="mk1-publish-line" aria-hidden="true"><span /></div>
      <Smooth>
        <AnimatePresence initial={false} mode="wait">
          {entry ? (
            <motion.div
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={settle}
            >
              <ResultStats entry={entry} />
            </motion.div>
          ) : (
            <motion.form
              key="form"
              className="mk1-publish-form"
              onSubmit={publish}
              exit={{ opacity: 0, y: -5, transition: { duration: 0.14 } }}
              aria-busy={posting}
            >
              <label className="mk1-publish-nickname">
                <span className="mk1-publish-label">nickname <small>optional</small></span>
                <input
                  className="mk1-board-input"
                  type="text"
                  aria-label="nickname"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={posting}
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? errorId : undefined}
                  value={nickname}
                  onChange={(event) => {
                    setNickname(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <button type="submit" className="mk1-btn primary" disabled={posting || !!nameError}>
                {posting ? "publishing…" : "publish result"}
              </button>
              {(nameError || error) && <p id={errorId} className="mk1-top-problem" role="alert">{nameError || error}</p>}
            </motion.form>
          )}
        </AnimatePresence>
      </Smooth>
    </section>
  );
}
