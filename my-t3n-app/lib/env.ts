// Loads the repo-root `.env.local` into `process.env` before any script
// reads a key. The scripts otherwise rely on shell `export`, which does
// not work the same way on Windows PowerShell and never picks up the
// `.env.local` file the challenge ships. Importing this module (first,
// from lib/session.ts) makes `npm run <step>` work with only the
// `.env.local` file present.
//
// Rules:
//   - A value already in the real environment wins (an explicit
//     `export` / `$env:` still overrides the file).
//   - `AGENT_KEY` (needed by the demo scripts) falls back to the second
//     key in `.env.local`, `T3N_API_KEY_2`, so the two-party demo runs
//     with the keys the file already carries.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// lib/env.ts -> ../../.env.local == repo root, regardless of cwd.
const ENV_PATH = fileURLToPath(new URL("../../.env.local", import.meta.url));

try {
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching surrounding quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch (err) {
  // No .env.local is fine when the caller uses real env vars instead.
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

// The demo scripts read AGENT_KEY. The shipped .env.local names the
// second key T3N_API_KEY_2, so map it across when AGENT_KEY is unset.
if (!process.env.AGENT_KEY && process.env.T3N_API_KEY_2) {
  process.env.AGENT_KEY = process.env.T3N_API_KEY_2;
}
