import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { EASE, Unfold } from "./anim";
import { boardNumber, loadBoard, type BoardEntry } from "./board/api";
import { PublishResult } from "./board/PublishResult";
import { LuArrowLeft, LuChevronDown, LuLink2, LuTrophy } from "./icons";
import { isBoardToken } from "./serial/board";
import "./mk1.css";
import "./top.css";

function fragment() {
  return window.location.hash.slice(1);
}

function clearResultFragment(hash: string) {
  if (isBoardToken(resultToken(hash))) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
}

function resultToken(link: string) {
  const start = link.indexOf("#") + 1;
  try {
    return decodeURIComponent(link.slice(start)).replace(/\s+/g, "");
  } catch {
    return "";
  }
}

export function Mk1Top() {
  const [hash, setHash] = useState(() => typeof window === "undefined" ? "" : fragment());
  const activeLink = useRef(hash);
  const [importOpen, setImportOpen] = useState(() => !!hash && !isBoardToken(resultToken(hash)));
  const [pastedLink, setPastedLink] = useState("");
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [boardError, setBoardError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number>();
  const [published, setPublished] = useState<BoardEntry | null>(null);
  const importId = useId();
  const still = useReducedMotion();
  const linkedToken = resultToken(hash);
  const pastedToken = resultToken(pastedLink);
  const hasLinkedToken = isBoardToken(linkedToken);

  useEffect(() => {
    clearResultFragment(fragment());
    const onHashChange = () => {
      const next = fragment();
      clearResultFragment(next);
      activeLink.current = next;
      setHash(next);
      setImportOpen(!!next && !isBoardToken(resultToken(next)));
      setPastedLink("");
      setPublished(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBoardError("");
    loadBoard(controller.signal, offset)
      .then((page) => {
        if (!controller.signal.aborted) {
          setEntries(page.entries);
          setNextOffset(page.nextOffset);
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setBoardError(error.message);
      });
    return () => controller.abort();
  }, [offset, refresh]);

  const refreshBoard = () => setRefresh((count) => count + 1);
  const changePage = (pageOffset: number) => {
    setEntries(null);
    setNextOffset(undefined);
    setOffset(pageOffset);
  };
  const publishPastedResult = (entry: BoardEntry) => {
    setPublished(entry);
    refreshBoard();
  };
  const publishLinkedResult = (entry: BoardEntry) => {
    if (activeLink.current === hash) setPublished(entry);
    refreshBoard();
  };

  return (
    <MotionConfig reducedMotion="user">
      <section className="mk1 mk1-top" aria-labelledby="mk1-top-title">
        <header className="mk1-top-header">
          <a className="mk1-quiet mk1-top-back" href="/mk1/">
            <LuArrowLeft size={17} aria-hidden="true" /> back to mk-1
          </a>
          <h1 className="mk1-top-title" id="mk1-top-title">
            <LuTrophy aria-hidden="true" /> leaderboard
          </h1>
        </header>

        {hasLinkedToken && <PublishResult key={linkedToken} token={linkedToken} onPublished={publishLinkedResult} />}

        <div className="card mk1-top-board">
          {boardError && (
            <div className="mk1-top-state">
              <p role="alert" className="mk1-top-problem">{boardError}</p>
              <button type="button" className="mk1-btn" onClick={refreshBoard}>try again</button>
            </div>
          )}
          {!entries && !boardError && <p className="mk1-top-state" role="status">loading leaderboard…</p>}
          {entries?.length === 0 && !boardError && <p className="mk1-top-state">no results yet</p>}
          {!!entries?.length && (
            <table aria-label="leaderboard standings">
              <thead>
                <tr>
                  <th scope="col">rank</th>
                  <th scope="col">player</th>
                  <th scope="col">score</th>
                  <th scope="col">solved</th>
                  <th scope="col" className="mk1-top-stat">instructions</th>
                  <th scope="col" className="mk1-top-stat">cycles</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.card} className={entry.card === published?.card ? "mk1-top-fresh" : undefined}>
                    <td className="mono">{offset + index + 1}</td>
                    <th scope="row" className="mk1-top-card">
                      <bdi>{entry.nickname || entry.card}</bdi>
                      <span className="mk1-top-card-cost">
                        {boardNumber.format(entry.instructions)} instr · {boardNumber.format(entry.cycles)} cycles
                      </span>
                    </th>
                    <td className="mono mk1-top-score">{boardNumber.format(entry.score)}</td>
                    <td className="mono">{boardNumber.format(entry.solved)}</td>
                    <td className="mono mk1-top-stat">{boardNumber.format(entry.instructions)}</td>
                    <td className="mono mk1-top-stat">{boardNumber.format(entry.cycles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(offset > 0 || nextOffset !== undefined) && (
            <nav className="mk1-top-pages" aria-label="leaderboard pages">
              <button className="mk1-btn" type="button" disabled={offset === 0 || entries === null}
                onClick={() => changePage(Math.max(0, offset - 100))}>previous</button>
              <button className="mk1-btn" type="button" disabled={nextOffset === undefined}
                onClick={() => { if (nextOffset !== undefined) changePage(nextOffset); }}>next</button>
            </nav>
          )}
          {(!hasLinkedToken || published) && (
            <div className="mk1-top-import">
              <button
                type="button"
                className="mk1-top-import-toggle"
                aria-expanded={importOpen}
                aria-controls={importId}
                onClick={() => setImportOpen((open) => !open)}
              >
                <LuLink2 size={18} aria-hidden="true" />
                submit with a link
                <LuChevronDown className="mk1-top-import-chevron" size={18} aria-hidden="true" />
              </button>
              <motion.div
                id={importId}
                className="mk1-top-import-window"
                initial={false}
                animate={{ height: importOpen ? "auto" : 0, opacity: importOpen ? 1 : 0 }}
                transition={{ height: { duration: still ? 0 : 0.44, ease: EASE }, opacity: { duration: still ? 0 : 0.22 } }}
                inert={!importOpen}
              >
                <div className="mk1-top-import-body">
                  <input
                    className="mk1-board-input mk1-result-link"
                    type="text"
                    inputMode="url"
                    aria-label="result link"
                    placeholder="paste the link from top"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    dir="ltr"
                    value={pastedLink}
                    onChange={(event) => setPastedLink(event.target.value)}
                    onPaste={(event) => {
                      const link = event.clipboardData.getData("text/plain");
                      if (/[\r\n]/.test(link)) {
                        event.preventDefault();
                        setPastedLink(link.replace(/\s+/g, ""));
                      }
                    }}
                  />
                  <AnimatePresence initial={false}>
                    {isBoardToken(pastedToken) ? (
                      <Unfold key={pastedToken} gap={0}>
                        <PublishResult token={pastedToken} onPublished={publishPastedResult} embedded />
                      </Unfold>
                    ) : (pastedLink.trim() || (hash && !hasLinkedToken)) && (
                      <Unfold key="error" gap={0}>
                        <p role="alert" className="mk1-top-problem mk1-import-error">paste the complete result link from top.</p>
                      </Unfold>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </section>
    </MotionConfig>
  );
}
