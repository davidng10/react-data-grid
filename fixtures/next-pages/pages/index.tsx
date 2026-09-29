import Head from "next/head";
import Link from "next/link";

import Example from "../Example";

export default function Page() {
  return (
    <>
      <Head>
        <title>Packed Pages Router consumer</title>
      </Head>
      <Link href="/other">Other page</Link>
      <Example />
    </>
  );
}
