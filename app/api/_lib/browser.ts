import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";

export async function launchBrowser() {
  const isLocal = !process.env.AWS_REGION; // Vercel met AWS_REGION en prod

  if (isLocal) {
    // En local → Playwright standard (si tu veux) ou core + chromium local
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true });
  }

  // En prod (Vercel) → chromium Lambda
  return await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}
