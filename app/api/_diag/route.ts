export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import fs from "fs";
import path from "path";

function listDir(p: string) {
  try {
    return fs.readdirSync(p);
  } catch {
    return null;
  }
}

export async function GET() {
  const cwd = process.cwd();
  const bases = [
    path.join(cwd, "node_modules", "playwright-core", ".local-browsers"),
    path.join(cwd, "node_modules", "playwright", ".local-browsers"),
  ];

  const candidates = [
    path.join(bases[0], "chromium-1181", "chrome-linux", "chrome"),
    path.join(bases[0], "chromium_headless_shell-1181", "chrome-linux", "headless_shell"),
    path.join(bases[1], "chromium-1181", "chrome-linux", "chrome"),
    path.join(bases[1], "chromium_headless_shell-1181", "chrome-linux", "headless_shell"),
  ];

  const payload = {
    env: {
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS,
    },
    cwd,
    bases,
    basesExists: bases.map(b => ({ path: b, exists: fs.existsSync(b), list: listDir(b) })),
    candidates: candidates.map(p => ({ path: p, exists: fs.existsSync(p) })),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
