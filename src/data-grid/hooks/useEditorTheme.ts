import { useLayoutEffect } from "react";

import { applyGridTheme, readGridTheme } from "../internal/theme";

import type { RefObject } from "react";

/** Editor-local subscription: no polling, cell subscriptions, or portal mutation feedback. */
export function useEditorTheme(
  sourceRef: RefObject<HTMLDivElement | null>,
  target: HTMLDivElement | null
): void {
  useLayoutEffect(() => {
    const source = sourceRef.current;
    if (!source || !target) return;
    let raf = 0;
    const refresh = () => applyGridTheme(target, readGridTheme(source));
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        refresh();
      });
    };
    refresh();
    const observer = new MutationObserver(schedule);
    for (
      let element: HTMLElement | null = source;
      element;
      element = element.parentElement
    ) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    window.addEventListener("resize", schedule);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      media?.removeEventListener("change", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sourceRef, target]);
}
