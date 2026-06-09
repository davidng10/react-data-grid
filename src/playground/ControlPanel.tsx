import type { CSSProperties, ReactNode } from "react";

// Kitchen-sink control strip for the playground demo. Presentational only — all state lives in
// GridPlayground and is fed back to the grid. NOT part of the shippable grid (src/data-grid/).

export interface ControlPanelProps {
  rowSelection: boolean;
  onRowSelectionChange: (v: boolean) => void;
  freezeLeft: number;
  onFreezeLeftChange: (v: number) => void;
  freezeRight: number;
  onFreezeRightChange: (v: number) => void;
  rowHeight: number;
  onRowHeightChange: (v: number) => void;
  /** Upper bound per side, so left + right can never swallow the whole grid. */
  maxFreeze: number;
}

const ROW_HEIGHTS = [28, 32, 40];

const strip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 18,
  padding: "8px 16px",
  borderBottom: "1px solid #e7e5e4",
  background: "#fafaf9",
  fontSize: 12,
  color: "#44403c",
};

const groupLabel: CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#78716c",
};

const divider: CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: "#e7e5e4",
};

function Group(props: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={groupLabel}>{props.label}</span>
      {props.children}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
  const { checked, onChange } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 38,
        height: 22,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        padding: 0,
        background: checked ? "#2563eb" : "#d6d3d1",
        transition: "background 120ms",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          transition: "left 120ms",
        }}
      />
    </button>
  );
}

function Stepper(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const { value, min, max, onChange, suffix } = props;
  const btn = (disabled: boolean): CSSProperties => ({
    width: 24,
    height: 24,
    border: "1px solid #d6d3d1",
    background: disabled ? "#f5f5f4" : "#fff",
    color: disabled ? "#a8a29e" : "#44403c",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    fontSize: 14,
    lineHeight: "22px",
    padding: 0,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        aria-label="decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        style={btn(value <= min)}
      >
        −
      </button>
      <span style={{ minWidth: 16, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <button
        type="button"
        aria-label="increase"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        style={btn(value >= max)}
      >
        +
      </button>
      {suffix && <span style={{ color: "#78716c" }}>{suffix}</span>}
    </div>
  );
}

function Segmented(props: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const { options, value, onChange } = props;
  return (
    <div style={{ display: "inline-flex", border: "1px solid #d6d3d1", borderRadius: 6, overflow: "hidden" }}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              border: "none",
              padding: "4px 10px",
              cursor: "pointer",
              background: active ? "#2563eb" : "#fff",
              color: active ? "#fff" : "#44403c",
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    rowSelection,
    onRowSelectionChange,
    freezeLeft,
    onFreezeLeftChange,
    freezeRight,
    onFreezeRightChange,
    rowHeight,
    onRowHeightChange,
    maxFreeze,
  } = props;

  // Keep left + right from overlapping: each side's effective max leaves room for the other.
  const leftMax = Math.min(maxFreeze, maxFreeze - freezeRight);
  const rightMax = Math.min(maxFreeze, maxFreeze - freezeLeft);

  return (
    <div style={strip}>
      <Group label="Row selection">
        <Toggle checked={rowSelection} onChange={onRowSelectionChange} />
      </Group>

      <div style={divider} />

      <Group label="Freeze left">
        <Stepper value={freezeLeft} min={0} max={leftMax} onChange={onFreezeLeftChange} suffix="col(s)" />
      </Group>

      <Group label="Freeze right">
        <Stepper value={freezeRight} min={0} max={rightMax} onChange={onFreezeRightChange} suffix="col(s)" />
      </Group>

      <div style={divider} />

      <Group label="Row height">
        <Segmented options={ROW_HEIGHTS} value={rowHeight} onChange={onRowHeightChange} />
      </Group>
    </div>
  );
}
