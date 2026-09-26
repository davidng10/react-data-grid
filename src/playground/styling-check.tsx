import { createRoot } from "react-dom/client";

import { StylingPlayground } from "./pages/StylingPlayground";

// Deliberately omit index.css and its global reset.
createRoot(document.getElementById("root")!).render(<StylingPlayground />);
