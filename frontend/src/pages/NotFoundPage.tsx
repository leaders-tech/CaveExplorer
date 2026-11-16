/*
This file shows the page for addresses that do not exist in the app.
Edit this file when the "page not found" text or its links change.
Do not copy this file. Keep one catch-all page for unknown addresses.
*/

import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black p-8 text-center font-pixel text-stone-300">
      <h1 className="text-5xl tracking-widest">Page not found</h1>
      <p className="text-2xl text-stone-500">You took a wrong turn in the dark. This address does not exist.</p>
      <Link className="border-2 border-stone-500 px-6 py-2 text-2xl hover:border-red-800" to="/">
        Go to home page
      </Link>
    </section>
  );
}
