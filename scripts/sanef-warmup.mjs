// scripts/sanef-warmup.mjs
import { chromium } from "playwright";
import fs from "fs";

const URL = "https://www.sanef.com/client/index.html?lang=fr#basket";
const stateFile = "sanef-state.json";
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";

const run = async () => {
  const browser =
    (await chromium.launch({ headless: false, channel: "chrome" }).catch(() => null)) ||
    (await chromium.launch({ headless: false }));
  const context = await browser.newContext({
    userAgent: ua,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });

  const page = await context.newPage();
  console.log("➡️ Ouverture:", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log("⚠️ Cloudflare : attends 5–15s sans rien faire…");
  try { await page.waitForLoadState("networkidle", { timeout: 45000 }); } catch {}

  try { await page.getByRole("button", { name: /Accepter|Tout accepter|J'accepte/i }).click({ timeout: 3000 }); } catch {}

  try { await page.screenshot({ path: "public/sanef-warmup.png", fullPage: true }); } catch {}
  await context.storageState({ path: stateFile });

  await browser.close();
  console.log("✅ Session sauvegardée dans sanef-state.json, capture dans /public/sanef-warmup.png");
};

run().catch((e) => { console.error(e); process.exit(1); });
