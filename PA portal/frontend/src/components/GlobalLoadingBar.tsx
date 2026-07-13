"use client";

import { useEffect } from "react";
import { installFetchLoader } from "@/lib/loading-bar";

/**
 * Installs the app-wide fetch → loading-bar hook once, on the client. Renders
 * nothing itself — the visible bar lives in the header (TopBar) as its bottom
 * border. Mounted once in the root layout so the hook is active on every page.
 */
export default function GlobalLoadingBar() {
  useEffect(() => {
    installFetchLoader();
  }, []);
  return null;
}
