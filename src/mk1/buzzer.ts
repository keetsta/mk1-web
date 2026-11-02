import { useEffect, useRef } from "react";

/** the card's buzzer in the browser: a square wave at the shell's frequency (try it only; a real card beeps itself) */
export function useBuzzer(hz: number, on: boolean) {
  const audio = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);

  useEffect(() => {
    const audible = on && hz > 0;
    if (!audio.current) {
      if (!audible) return;
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.connect(gain);
      osc.start();
      audio.current = { ctx, osc, gain };
    }
    const { ctx, osc, gain } = audio.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (audible) osc.frequency.setTargetAtTime(Math.min(hz, 8000), ctx.currentTime, 0.002);
    gain.gain.setTargetAtTime(audible ? 0.035 : 0, ctx.currentTime, 0.008);
  }, [hz, on]);

  useEffect(() => () => { audio.current?.ctx.close(); }, []);
}
