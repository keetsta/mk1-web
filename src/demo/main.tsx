import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Mk1, Mk1Top } from "../mk1";
import "./site.css";

const leaderboard = ["/mk1/top", "/mk1/top/", "/mk1/top/index.html"].includes(window.location.pathname);
if (leaderboard) document.title = "leaderboard · mk-1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {leaderboard ? <Mk1Top /> : <Mk1 />}
  </StrictMode>,
);
