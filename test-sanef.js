// test-sanef.js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  await page.goto("https://www.sanef.com/client/index.html?lang=fr#basket", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // 1) Bannière cookies – clique coûte que coûte
  const cookieButtons = [
    page.getByRole("button", { name: /tout accepter/i }),
    page.locator('button:has-text("Tout accepter")'),
    page.locator("#axeptio_btn_acceptAll"),
    page.locator('[data-ax-accept]'),
    page.locator('[id*="accept"][id*="all"]'),
  ];
  for (const btn of cookieButtons) {
    if (await btn.count()) {
      try { await btn.click({ timeout: 1500 }); break; } catch {}
    }
  }

  // petit “respire” pour laisser le DOM se stabiliser
  try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
  await page.waitForTimeout(400);

  // 2) Saisir la plaque (plusieurs fallbacks)
  const inputs = [
    page.getByPlaceholder("XX123XX"),
    page.locator('[data-test-id="page-basket-plate-input"] input'),
    page.locator('input[name*="immatricul" i]'),
    page.locator('input[name*="plaque" i]'),
    page.locator('input[name*="plate" i]'),
  ];

  let input = null;
  for (const loc of inputs) {
    if (await loc.count()) {
      try { await loc.first().waitFor({ state: "visible", timeout: 1500 }); input = loc.first(); break; } catch {}
    }
  }
  if (!input) throw new Error("Input plaque introuvable (local).");

  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click().catch(() => {});
  await input.fill("AA123AA").catch(async () => {
    await input.type("AA123AA", { delay: 40 });
  });

  // 3) Clic “Vérifier mes péages…”
  const submits = [
    page.locator('[data-test-id="page-basket-submit-button"]'),
    page.locator('button:has-text("Vérifier")'),
    page.locator('button:has-text("payer")'),
    page.locator('button:has-text("Rechercher")'),
  ];
  for (const b of submits) {
    if (await b.count()) {
      try { await b.first().click({ timeout: 2000 }); break; } catch {}
    }
  }

  // Screenshot pour vérifier visuellement
  await page.screenshot({ path: "local-sanef.png", fullPage: true });
  console.log("✅ Screenshot écrit: local-sanef.png");

  await ctx.close();
  await browser.close();
})();
