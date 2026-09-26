import { createBrowserRouter } from "react-router";

import { GridPlayground } from "../playground/pages/GridPlayground";
import { IntegrationPlayground } from "../playground/pages/IntegrationPlayground";
import { LoadingPlayground } from "../playground/pages/LoadingPlayground";
import { StylingPlayground } from "../playground/pages/StylingPlayground";

// Routes:
//   /       — landing
//   /grid   — the grid playground (committed DOM architecture)
export const router = createBrowserRouter([
  { path: "/", element: <GridPlayground /> },
  { path: "/styling", element: <StylingPlayground /> },
  { path: "/integration", element: <IntegrationPlayground /> },
  { path: "/loading", element: <LoadingPlayground /> },
]);
