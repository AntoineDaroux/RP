import { chromium } from "playwright-core";

export async function launchBrowser() {
  // Args safe pour environnements serverless
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
  ];

  // ⚠️ Ne pas passer executablePath: Playwright sait où est son Chromium
  return chromium.launch({
    headless: true,
    args,
  });
}
