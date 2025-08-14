import { chromium, LaunchOptions } from "playwright";
import fs from "fs";
import path from "path";

// Ce fallback garantit que Playwright cherche dans node_modules/.local-browsers
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

/**
 * Résout le chemin absolu du binaire "headless_shell" installé par Playwright
 * dans node_modules/playwright-core/.local-browsers/chromium_headless_shell-xxxx/...
 */
function resolveHeadlessShellPath(): string | undefined {
  try {
    const root = process.cwd();
    const base = path.join(
      root,
      "node_modules",
      "playwright-core",
      ".local-browsers"
    );
    const entries = fs.readdirSync(base, { withFileTypes: true });

    // Cherche un répertoire du type "chromium_headless_shell-1181"
    const dir = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("chromium_headless_shell-"))
      .map((e) => e.name)
      .sort() // au cas où plusieurs versions -> prend la plus récente
      .pop();

    if (!dir) return undefined;

    // Chemin du binaire
    const bin = path.join(
      base,
      dir,
      "chrome-linux",
      "headless_shell"
    );
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
    (options as any).executablePath = executablePath;
  }

  return chromium.launch(options);
}
