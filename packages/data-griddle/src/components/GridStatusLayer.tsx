import { inertAttribute } from "../internal/inert";
import { EmptyRowsLayer } from "./EmptyRowsLayer";

import type { ReactNode } from "react";

import "../internal/loading.css";

/** Stationary presentation only: never supplies fake rows to the virtualizers or renderers. */
export function GridStatusLayer({
  hasResult,
  rowCount,
  loading,
  rowHeight,
  totalWidth,
  loadingIndicator,
  loadingLabel,
  emptyContent,
}: {
  hasResult: boolean;
  rowCount: number;
  loading: boolean;
  rowHeight: number;
  totalWidth: number;
  loadingIndicator: ReactNode;
  loadingLabel: string;
  emptyContent: ReactNode;
}) {
  return (
    <>
      {hasResult && rowCount === 0 && (
        <div
          className="dgr-empty-content"
          style={{ top: rowHeight }}
          inert={loading ? inertAttribute : undefined}
        >
          {emptyContent}
        </div>
      )}
      {loading && (
        <div
          className="dgr-loading-layer"
          data-grid-state={hasResult ? "refreshing" : "initial-loading"}
        >
          <div
            className="dgr-loading-body"
            style={{
              top: rowHeight,
              maxWidth: hasResult ? undefined : totalWidth,
            }}
            aria-hidden="true"
            inert={inertAttribute}
          >
            {hasResult ? (
              <div className="dgr-loading-indicator">
                {loadingIndicator === undefined ? (
                  <span className="dgr-loading-spinner" />
                ) : (
                  loadingIndicator
                )}
              </div>
            ) : (
              <EmptyRowsLayer rowHeight={rowHeight} />
            )}
          </div>
        </div>
      )}
      {/* Outside aria-busy/inert content so the loading announcement is not deferred. */}
      <div
        className="dgr-status-text"
        role={loading ? "status" : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {loading ? loadingLabel : ""}
      </div>
    </>
  );
}
