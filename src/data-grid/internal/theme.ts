// Private leaf notification: built-in editors remeasure after typography is applied.
export const EDITOR_THEME_CHANGE = "dgr-internal-theme-change";

/** Public tokens copied to an active body-mounted editor. Keep in sync with docs/STYLING.md. */
export const GRID_THEME_TOKENS = [
  "--dgr-background",
  "--dgr-text-color",
  "--dgr-font-family",
  "--dgr-font-size",
  "--dgr-cell-padding-inline",
  "--dgr-cell-border-color",
  "--dgr-header-background",
  "--dgr-header-font-weight",
  "--dgr-header-border-color",
  "--dgr-frozen-divider-color",
  "--dgr-selection-background",
  "--dgr-selection-border-color",
  "--dgr-focus-color",
  "--dgr-resize-indicator-color",
  "--dgr-reorder-indicator-color",
  "--dgr-skeleton-background",
  "--dgr-skeleton-bar-color",
  "--dgr-pending-color",
  "--dgr-error-color",
  "--dgr-error-background",
  "--dgr-editor-background",
  "--dgr-editor-radius",
  "--dgr-editor-shadow",
  "--dgr-editor-padding",
  "--dgr-loading-overlay-background",
  "--dgr-loading-indicator-color",
  "--dgr-empty-color",
] as const;
const THEME_PROPERTIES = [
  ...GRID_THEME_TOKENS,
  "font-family",
  "font-size",
  "color",
  "direction",
];

export function readGridTheme(source: HTMLElement): Record<string, string> {
  const computed = getComputedStyle(source);
  return Object.fromEntries(
    THEME_PROPERTIES.map((name) => [
      name,
      computed.getPropertyValue(name).trim(),
    ])
  );
}

export function applyGridTheme(
  target: HTMLElement,
  values: Record<string, string>
): void {
  for (const name of THEME_PROPERTIES) {
    const value = values[name];
    if (value) target.style.setProperty(name, value);
    else target.style.removeProperty(name);
  }
  target.dispatchEvent(new Event(EDITOR_THEME_CHANGE));
}
