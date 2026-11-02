import { BOARD, BUTTON, LEDS, SENSOR, SILK, USB, type Body } from "./geometry";
import "./preview.css";

type Props = {
  /** the matrix, 9 rows, bit 15 = leftmost column */
  rows: Uint16Array;
  /** the card's button can be pressed here (try it); on a real card it is the card's own */
  pressable: boolean;
  pressed: boolean;
  onPress?(down: boolean): void;
};

const place = (b: Body) => `translate(${b.x} ${b.y}) rotate(${b.rot})`;

/** the front of the card, drawn from the board files: the lettering, the matrix, the button, the sensor */
export function CardPreview({ rows, pressable, pressed, onPress }: Props) {
  const lit = (i: number) => (rows[i >> 4] >> (15 - (i & 15))) & 1;
  const side = Math.min(BUTTON.w, BUTTON.h);
  const press = (down: boolean) => pressable && onPress?.(down);
  return (
    <div className="mc1-card" style={{ aspectRatio: `${BOARD.w} / ${BOARD.h}` }}>
      <svg viewBox={`0 0 ${BOARD.w} ${BOARD.h}`} role="img" aria-label="the mc-1 card, its matrix showing what the card shows">
        <rect className="mc1-board" width={BOARD.w} height={BOARD.h} rx={BOARD.r} />
        <path className="mc1-silk" d={SILK} />
        <g className="mc1-usb" transform={place(USB)}>
          <rect x={-USB.w / 2} y={-USB.h / 2} width={USB.w} height={USB.h} rx={1} />
          <rect className="mc1-usb-mouth" x={-USB.w / 2 + 0.9} y={USB.h / 2 - 0.7} width={USB.w - 1.8} height={0.7} rx={0.3} />
        </g>
        <g className="mc1-sensor" transform={place(SENSOR)}>
          <rect x={-SENSOR.w / 2} y={-SENSOR.h / 2} width={SENSOR.w} height={SENSOR.h} rx={0.15} />
          <rect className="mc1-sensor-window" x={-0.55} y={-0.35} width={1.1} height={0.7} rx={0.12} />
        </g>
        <g
          className="mc1-button"
          data-pressable={pressable || undefined}
          data-pressed={pressed || undefined}
          transform={place(BUTTON)}
          role={pressable ? "button" : undefined}
          tabIndex={pressable ? 0 : undefined}
          aria-label={pressable ? "the card's button" : undefined}
          aria-pressed={pressable ? pressed : undefined}
          onPointerDown={(e) => { if (!pressable) return; e.currentTarget.setPointerCapture(e.pointerId); press(true); }}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(true); } }}
          onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") press(false); }}
        >
          <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={0.35} />
          <circle className="mc1-button-cap" r={1.75} />
        </g>
        <g className="mc1-matrix">
          {LEDS.map(([x, y, rot], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`} className={lit(i) ? "mc1-led on" : "mc1-led"}>
              <rect x={-0.8} y={-0.4} width={1.6} height={0.8} rx={0.12} />
              <rect className="mc1-led-lens" x={-0.48} y={-0.27} width={0.96} height={0.54} rx={0.1} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
