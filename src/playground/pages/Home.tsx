import { Link } from "react-router";

interface Variant {
  path: string;
  name: string;
  desc: string;
}

const VARIANTS: Variant[] = [
  {
    path: "/grid",
    name: "Data grid",
    desc: "Absolute-positioned cells + transform. The committed architecture.",
  },
];

export function Home() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
        lineHeight: 1.6,
      }}
    >
      <p
        style={{
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#4f46e5",
          fontWeight: 700,
          margin: 0,
        }}
      >
        Data Grid · Playground
      </p>
      <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
        {VARIANTS.map((v) => (
          <Link
            key={v.path}
            to={v.path}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              style={{
                border: "1px solid #e7e5e4",
                borderRadius: 10,
                padding: "16px 18px",
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <strong style={{ fontSize: 16 }}>{v.name}</strong>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 20,
                    color: "#fff",
                    background: "#16a34a",
                  }}
                >
                  ACTIVE
                </span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 14, color: "#57534e" }}>
                {v.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
