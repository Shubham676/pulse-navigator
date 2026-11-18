// Release info shown in the app (side menu) and returned by /healthz.
// When releasing: bump "version" in server/package.json, set RELEASED, and add an entry to CHANGELOG.md.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;
export const RELEASED = "2026-11-18";
