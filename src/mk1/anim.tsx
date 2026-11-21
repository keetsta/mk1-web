import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** the site's --ease */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** a panel opening where it stands: grows from nothing, its gap to the block above included (the negative
 *  margin gives the gap back only in a flex column: a grid track never goes below zero) */
export function Unfold({ children, gap = 20 }: { children: ReactNode; gap?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0, marginTop: -gap, overflow: "hidden" }}
      animate={{ opacity: 1, height: "auto", marginTop: 0, transitionEnd: { overflow: "visible" } }}
      exit={{ opacity: 0, height: 0, marginTop: -gap, overflow: "hidden" }}
      transition={{ duration: 0.42, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** a box whose height follows its content's, eased, where the content changes under it (a tab's steps, the
 *  next step of an install). it clips only while it moves, so shadows and focus rings inside stay whole */
export function Smooth({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const [height, setHeight] = useState<number | "auto">("auto");
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current!;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={still ? { duration: 0 } : { duration: 0.36, ease: EASE }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving ? "hidden" : "visible" }}
    >
      <div ref={inner} className="mk1-smooth">{children}</div>
    </motion.div>
  );
}

/** one icon giving way to another in its place: the old one shrinks away as the new one springs in */
export function Swap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="mk1-swap">
      <AnimatePresence initial={false}>
        <motion.span
          key={id}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.4 }}
          transition={{ opacity: { duration: 0.16 }, scale: { type: "spring", stiffness: 520, damping: 24 } }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
