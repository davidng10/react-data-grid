import { DataGrid } from "data-griddle";
import Link from "next/link";

import Example from "../Example";

// Direct Server Component import exercises the package's own client boundary.
export default function Page() {
  if (!DataGrid) throw new Error("Missing public client export");
  return (
    <>
      <Link href="/other">Other page</Link>
      <Example />
    </>
  );
}
