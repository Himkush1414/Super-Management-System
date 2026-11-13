"use client";

import { useEffect } from "react";

/**
 * Sets the browser tab title once the page is on screen, for a title that
 * needs a database read. In `generateMetadata` that read also ran for every
 * <Link> prefetch of the page (Next renders metadata for those too, and
 * gives page code no way to tell a prefetch from a visit), so each order link
 * in view cost two reads for a title nobody saw. `title` is the full text,
 * from tabTitle() in lib/title.ts.
 */
export function TabTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
