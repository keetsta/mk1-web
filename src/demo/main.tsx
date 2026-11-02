import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Mk1 } from "../mk1";
import "./site.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Mk1 />
  </StrictMode>,
);
