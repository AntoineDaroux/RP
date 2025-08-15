// app/api/_lib/browser.ts
import chromium from "@sparticuz/chromium";
import type { Browser } from "playwright-core";

export async function launchBrowser(): Promise<Browser> {
  const isVercel = !!process.env.VERCEL;

  if (!isVercel) {
    // Local : Playwright complet (avec ses navigateurs installés en local)
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true });
  }

  // Prod (Vercel) : Playwright Core + Sparticuz (binaire Lambda/Vercel)
  const { chromium: pwChromium } = await import("playwright-core");
  return pwChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true, // éviter l'erreur de typing sur chromium.headless
  });
}
