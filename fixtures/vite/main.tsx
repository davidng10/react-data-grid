import { createRoot } from "react-dom/client";

import Example from "./Example";

import "data-griddle/styles.css";

createRoot(document.getElementById("root")!).render(
  <>
    <a href="/other.html">Other page</a>
    <Example />
  </>
);
