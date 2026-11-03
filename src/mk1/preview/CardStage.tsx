import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Card3D, Rect } from "./card3d/engine";
import { CardPreview } from "./CardPreview";
import "./stage.css";

type Props = {
  /** the matrix, 9 rows, bit 15 = leftmost column */
  rows: Uint16Array;
  /** the card's button can be pressed here (try it); on a real card it is the card's own */
  pressable: boolean;
  pressed: boolean;
  onPress?(down: boolean): void;
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The card: its drawing at once, then the card itself, in 3D, once WebGL, its light and its surface are
 *  ready; the drawing fades as the card lifts off the page. Without WebGL (or if the engine's chunk
 *  doesn't load) the drawing stays, and it stays for screen readers either way. */
export function CardStage({ rows, pressable, pressed, onPress }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = useRef<HTMLButtonElement>(null);
  const engine = useRef<Card3D | null>(null);
  const keyAt = useRef<Rect | null>(null);
  const [live, setLive] = useState(false);
  const [settled, setSettled] = useState(false);
  const now = useRef({ rows, pressed });
  now.current = { rows, pressed };

  useEffect(() => engine.current?.rows(rows), [rows]);
  useEffect(() => engine.current?.press(pressed), [pressed]);

  // the card's button, over its place in the picture: the pointer, the keyboard and screen readers
  const placeKey = () => {
    const b = key.current;
    const r = keyAt.current;
    const cv = canvas.current;
    if (!b || !r || !cv) return;
    b.style.left = `${cv.offsetLeft + r.x}px`;
    b.style.top = `${cv.offsetTop + r.y}px`;
    b.style.width = `${r.w}px`;
    b.style.height = `${r.h}px`;
  };
  useLayoutEffect(placeKey, [live, pressable]);

  useEffect(() => {
    const el = box.current!;
    const cv = canvas.current!;
    let card: Card3D | null = null;
    let gone = false;
    const born = performance.now();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dark = () => document.documentElement.dataset.theme === "dark";
    const layout = () => {
      if (!card) return;
      const c = cv.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!c.width || !b.width) return;
      card.layout(c.width, c.height, { x: b.left - c.left, y: b.top - c.top, w: b.width, h: b.height });
    };
    const ro = new ResizeObserver(layout);
    const io = new IntersectionObserver(([e]) => card?.visible(e.isIntersecting), { rootMargin: "160px" });
    const mo = new MutationObserver(() => card?.theme(dark()));

    (async () => {
      try {
        const { startCard } = await import("./card3d/engine");
        if (gone) return;
        card = startCard(cv, {
          dark: dark(),
          still,
          onPose: (r) => {
            keyAt.current = r;
            placeKey();
          },
          onSettle: () => setSettled(true),
          onLost: () => setLive(false),
        });
        if (!card) return;
        engine.current = card;
        layout();
        ro.observe(el);
        io.observe(el);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        card.rows(now.current.rows);
        card.press(now.current.pressed);
        await card.ready;
        // the page's own entrance first; then the drawing becomes the card and lifts off the page
        await wait(Math.max(0, 650 - (performance.now() - born)));
        if (gone) return;
        setLive(true);
        card.intro();
      } catch {
        // the engine's chunk or the surface didn't load: the drawing stays
        card?.dispose();
        card = null;
        engine.current = null;
      }
    })();
    return () => {
      gone = true;
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      card?.dispose();
      engine.current = null;
    };
  }, []);

  return (
    <div ref={box} className="mk1-cardstage" data-live={live || undefined} data-settled={settled || undefined}>
      <CardPreview rows={rows} pressable={pressable && !live} pressed={pressed} onPress={onPress} />
      <canvas ref={canvas} className="mk1-card3d" aria-hidden="true" />
      {live && pressable && (
        <button
          ref={key}
          type="button"
          className="mk1-card3d-key"
          aria-label="the card's button"
          aria-pressed={pressed}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onPress?.(true);
          }}
          onPointerUp={() => onPress?.(false)}
          onPointerCancel={() => onPress?.(false)}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              onPress?.(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") onPress?.(false);
          }}
        />
      )}
    </div>
  );
}
