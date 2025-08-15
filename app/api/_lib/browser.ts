// app/api/_lib/browser.ts
import type { Browser } from "playwright-core";
import { chromium as pwChromium } from "playwright-core";
import chromium from "@sparticuz/chromium";

export async function launchBrowser(): Promise<Browser> {
  const isVercel = !!process.env.VERCEL;

  if (!isVercel) {
    // En local, on utilise Playwright complet (avec ses navigateurs installés)
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true });
  }

  // En prod (Vercel), on utilise le binaire Sparticuz
  return pwChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true, // <- évite l'erreur TS sur chromium.headless
  });
}
