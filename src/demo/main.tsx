import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Mc1 } from "../mc1";
import "./site.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Mc1 />
  </StrictMode>,
);
