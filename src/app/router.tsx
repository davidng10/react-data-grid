import { createBrowserRouter } from "react-router";

import { GridPlayground } from "../playground/pages/GridPlayground";
import { LoadingPlayground } from "../playground/pages/LoadingPlayground";

// Routes:
//   /       — landing
//   /grid   — the grid playground (committed DOM architecture)
export const router = createBrowserRouter([
  { path: "/", element: <GridPlayground /> },
  { path: "/loading", element: <LoadingPlayground /> },
]);
