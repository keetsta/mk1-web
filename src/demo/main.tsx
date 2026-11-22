import { StrictMode } from "react";
import { AnimatePresence } from "motion/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Mk1, Mk1Top } from "../mk1";
import "./site.css";
import "../mk1/navigation.css";

const leaderboardPaths = ["/mk1/top", "/mk1/top/", "/mk1/top/index.html"];
const leaderboard = leaderboardPaths.includes(window.location.pathname);
if (leaderboard) document.title = "leaderboard · mk-1";

const from = document.referrer ? new URL(document.referrer) : null;
const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
const fromLeaderboard = from?.origin === location.origin && leaderboardPaths.includes(from.pathname);
const returning = navigation?.type === "back_forward" || (fromLeaderboard && navigation?.type !== "reload");
const rise = !matchMedia("(prefers-reduced-motion: reduce)").matches && !(returning && "onpagereveal" in window);
const root = createRoot(document.getElementById("root")!);

// Commit the first frame before the browser captures the incoming document.
flushSync(() => {
  root.render(
    <StrictMode>
      <AnimatePresence initial={rise}>
        {leaderboard ? <Mk1Top /> : <Mk1 />}
      </AnimatePresence>
    </StrictMode>,
  );
});
