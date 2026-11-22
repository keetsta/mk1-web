import { useEffect, useState } from "react";
import { boardNumber, loadBoard, type BoardEntry } from "./board/api";
import { PublishResult } from "./board/PublishResult";
import { LuArrowLeft, LuChevronDown, LuLink2, LuTrophy } from "./icons";
import { isBoardToken } from "./serial/board";
import "./mk1.css";
import "./top.css";

function fragment() {
  return window.location.hash.slice(1);
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
  const [pastedLink, setPastedLink] = useState("");
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [boardError, setBoardError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [published, setPublished] = useState<BoardEntry | null>(null);
  const linkedToken = resultToken(hash);
  const pastedToken = resultToken(pastedLink);
  const hasLinkedToken = isBoardToken(linkedToken);

  useEffect(() => {
    const onHashChange = () => {
      setHash(fragment());
      setPastedLink("");
      setPublished(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBoardError("");
    loadBoard(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setEntries(rows);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setBoardError(error.message);
      });
    return () => controller.abort();
  }, [refresh]);

  const refreshBoard = () => setRefresh((count) => count + 1);
  const publishLinkedResult = (entry: BoardEntry) => {
    if (fragment() === hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setHash("");
      setPublished(entry);
    }
    refreshBoard();
  };

  return (
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
      {published && (
        <p role="status" className="mk1-top-success">result published · score {boardNumber.format(published.score)}</p>
      )}

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
                <tr key={entry.card}>
                  <td className="mono">{index + 1}</td>
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
        {!hasLinkedToken && (
          <details className="mk1-top-import" open={hash ? true : undefined}>
            <summary>
              <LuLink2 size={18} aria-hidden="true" />
              submit with a link
              <LuChevronDown className="mk1-top-import-chevron" size={18} aria-hidden="true" />
            </summary>
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
              {isBoardToken(pastedToken) ? (
                <PublishResult key={pastedToken} token={pastedToken} onPublished={refreshBoard} embedded />
              ) : (pastedLink.trim() || hash) && (
                <p role="alert" className="mk1-top-problem">paste the complete result link from top.</p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
