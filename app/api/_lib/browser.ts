// app/api/_lib/browser.ts
import { chromium, type Browser } from "playwright";

/**
 * Lance un Chromium prêt pour la prod/CI.
 * Nécessite que Chromium soit installé au build (voir script postinstall).
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}
