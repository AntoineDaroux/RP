import { chromium, LaunchOptions } from "playwright";
import fs from "fs";
import path from "path";

// Toujours privilégier les navigateurs installés dans le projet
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

function findExecutable(): string | undefined {
  try {
    const base = path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
    const entries = fs.readdirSync(base, { withFileTypes: true });

    // Cherche la version la plus récente
    const latest = (prefix: string) =>
      entries
        .filter(e => e.isDirectory() && e.name.startsWith(prefix))
        .map(e => e.name)
        .sort()
        .pop();

    // 1) Tente d'abord le binaire "chrome" (souvent présent)
    const chromiumDir = latest("chromium-");
    if (chromiumDir) {
      const chromePath = path.join(base, chromiumDir, "chrome-linux", "chrome");
      if (fs.existsSync(chromePath)) return chromePath;
    }

    // 2) Sinon, fallback vers "headless_shell"
    const shellDir = latest("chromium_headless_shell-");
    if (shellDir) {
      const shellPath = path.join(base, shellDir, "chrome-linux", "headless_shell");
      if (fs.existsSync(shellPath)) return shellPath;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function launchBrowser() {
  const executablePath = findExecutable();

  const options: LaunchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  };

  if (executablePath) {
    (options as any).executablePath = executablePath;
  }

  return chromium.launch(options);
}
