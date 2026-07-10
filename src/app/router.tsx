import { createBrowserRouter } from "react-router";

import { GridPlayground } from "../playground/pages/GridPlayground";

// Routes:
//   /       — landing
//   /grid   — the grid playground (committed DOM architecture)
export const router = createBrowserRouter([
  { path: "/", element: <GridPlayground /> },
]);
