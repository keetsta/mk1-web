import { useId, useState, type FormEvent } from "react";
import { LuArrowUp } from "../icons";
import { boardNumber, boardUnavailable, publishBoardResult, type BoardEntry } from "./api";
import "../top.css";

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
  const panel = embedded ? "mk1-publish-form" : "card mk1-publish-form mk1-publish-panel";

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

  if (entry) {
    return (
      <div className={panel}>
        <p role="status" className="mk1-top-success">result published · score {boardNumber.format(entry.score)}</p>
        {!onPublished && <a className="mk1-btn" href="/mk1/top/" target="_blank" rel="noreferrer">view leaderboard</a>}
      </div>
    );
  }

  return (
    <form className={panel} onSubmit={publish}>
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
        <LuArrowUp size={17} aria-hidden="true" /> {posting ? "publishing…" : "publish result"}
      </button>
      {(nameError || error) && <p id={errorId} className="mk1-top-problem" role="alert">{nameError || error}</p>}
    </form>
  );
}
