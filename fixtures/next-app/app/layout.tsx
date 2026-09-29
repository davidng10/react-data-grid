import type { ReactNode } from "react";

import "data-griddle/styles.css";

export const metadata = { title: "Packed App Router consumer" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
