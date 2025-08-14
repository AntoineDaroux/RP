// app/api/_lib/browser.ts
import { chromium, LaunchOptions } from "playwright";
import fs from "fs";
import path from "path";

// Assure le bon répertoire des navigateurs (dans node_modules)
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

/**
 * Trouve le binaire "headless_shell" installé par Playwright dans:
 * node_modules/playwright-core/.local-browsers/chromium_headless_shell-xxxx/chrome-linux/headless_shell
 */
function resolveHeadlessShellPath(): string | undefined {
  try {
    const base = path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
    const entries = fs.readdirSync(base, { withFileTypes: true });
    const dir = entries
      .filter(e => e.isDirectory() && e.name.startsWith("chromium_headless_shell-"))
      .map(e => e.name)
      .sort()
      .pop(); // prend la version la plus récente

    if (!dir) return undefined;

    const bin = path.join(base, dir, "chrome-linux", "headless_shell");
    return fs.existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

export async function launchBrowser() {
  const executablePath = resolveHeadlessShellPath();

  const options: LaunchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };

  if (executablePath) {
    // on force explicitement le binaire local
    (options as any).executablePath = executablePath;
  }

  return chromium.launch(options);
}
