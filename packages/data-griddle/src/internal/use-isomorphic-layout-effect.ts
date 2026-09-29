import { useEffect, useLayoutEffect } from "react";

// SSR produces a shell. Geometry and subscriptions synchronize before browser paint,
// while the server must not register layout effects (React 18 warns about them).
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
