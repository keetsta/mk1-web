import { useState } from "react";
import { LuCheck, LuCopy } from "../icons";

/** a command to paste into a terminal, with a copy button */
export function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch { /* the text is selectable anyway */ }
  };
  return (
    <div className="mk1-cmd">
      <code className="mono">{text}</code>
      <button type="button" onClick={copy} aria-label={done ? "copied" : "copy"} title={done ? "copied" : "copy"}>
        {done ? <LuCheck size={16} /> : <LuCopy size={16} />}
      </button>
    </div>
  );
}
