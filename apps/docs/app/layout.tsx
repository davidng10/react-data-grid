import type { Metadata } from "next";
import type { ReactNode } from "react";

import "data-griddle/styles.css";
import "./docs.css";

export const metadata: Metadata = { title: "Data Griddle" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
