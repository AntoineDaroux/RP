// test-sanef.js
const { chromium } = require("playwright");

/* ---------- Helpers ---------- */

// Cookies: Sanef (panneau bleu) + Axeptio + OneTrust/Didomi + fallback
async function acceptAllCookiesEverywhere(page) {
  try { await page.waitForTimeout(800); } catch {}

  // 1) Sanef "bleu" (pas d'iframe la plupart du temps)
  try {
    const panel = page.locator('text="Ce site utilise des cookies"').first();
    const btn = page.getByRole("button", { name: /^tout accepter$/i }).first();

    await Promise.race([
      panel.waitFor({ state: "visible", timeout: 7000 }),
      btn.waitFor({ state: "visible", timeout: 7000 }),
    ]).catch(() => {});

    try { await page.waitForTimeout(400); } catch {}

    if (await btn.count()) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      try { await btn.click({ timeout: 6000, trial: true }); } catch {}
      await btn.click({ timeout: 6000, force: true, noWaitAfter: true });
      try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch {}
      if (!(await panel.isVisible().catch(() => false))) return;
    }

    // fallback clic souris aux coordonnées
    const maybe = await page.$('button:has-text("Tout accepter")');
    if (maybe) {
      const box = await maybe.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.up();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch {}
        if (!(await panel.isVisible().catch(() => false))) return;
      }
    }
  } catch {}

  // 2) Axeptio dans iframe
  try {
    const frameHandle = await page.waitForSelector('iframe[src*="axeptio"]', { timeout: 6000 }).catch(() => null);
    const frame = frameHandle ? await frameHandle.contentFrame() : null;
    if (frame) {
      const candidates = [
        "#axeptio_btn_acceptAll",
        'button:has-text("Tout accepter")',
        'button:has-text("Tout accepter et fermer")',
        "[data-ax-accept]",
        '[data-testid*="accept-all"]',
      ];
      for (const sel of candidates) {
        const loc = frame.locator(sel).first();
        if (await loc.count()) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await loc.click({ timeout: 8000, force: true });
          try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch {}
          return;
        }
      }
    }
  } catch {}

  // 3) OneTrust / Didomi
  try {
    const ot = page.locator("#onetrust-accept-btn-handler, button#accept-recommended-btn-handler").first();
    if (await ot.count()) { await ot.click({ timeout: 6000, force: true }); return; }
  } catch {}
  try {
    const didomi = page.frameLocator('iframe[src*="didomi"]').locator('button:has-text("Tout accepter"), [data-qa="consent-agree-all"]').first();
    if (await didomi.count()) { await didomi.click({ timeout: 6000, force: true }); return; }
  } catch {}

  // 4) Dernier recours (dev)
  try {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document
        .querySelectorAll('[class*="cookie"], [class*="consent"], #onetrust-banner-sdk, [id*="axeptio"]')
        .forEach((el) => (el.style.display = "none"));
      document.body.style.overflow = "auto";
      document.body.style.pointerEvents = "auto";
    });
  } catch {}
}

// Trouver input plaque (page + iframes)
async function findPlateInputEverywhere(page) {
  const sels = [
    'input[placeholder="XX123XX"]',
    'input[placeholder*="XX123" i]',
    '[data-test-id="page-basket-plate-input"] input',
    'input[name*="immatricul" i]',
    'input[name*="plaque" i]',
    'input[name*="plate" i]',
    "css:light=input[placeholder=\"XX123XX\"]",
    'css:light=input[placeholder*="XX123" i]',
    "css:light=[data-test-id=\"page-basket-plate-input\"] input",
    'css:light=input[name*="immatricul" i]',
    'css:light=input[name*="plaque" i]',
    'css:light=input[name*="plate" i]',
    'css:light=input[type="text"]',
    "css:light=input",
  ];

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}

  const tryRoot = async (root) => {
    for (const sel of sels) {
      const loc = root.locator(sel).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 1500 });
        return loc;
      } catch {}
    }
    return null;
  };

  const direct = await tryRoot(page);
  if (direct) return direct;

  for (const f of page.frames()) {
    const loc = await tryRoot(f);
    if (loc) return loc;
  }
  return null;
}

// Clic bouton “Vérifier…”
async function clickSubmitEverywhere(page) {
  const sels = [
    '[data-test-id="page-basket-submit-button"]',
    "css:light=[data-test-id=\"page-basket-submit-button\"]",
    'button:has-text("Vérifier")',
    'button:has-text("payer")',
    'button:has-text("Rechercher")',
    'css:light=button:has-text("Vérifier")',
    'css:light=button:has-text("payer")',
    'css:light=button:has-text("Rechercher")',
  ];
  for (const sel of sels) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 6000 }); return true; } catch {}
    }
  }
  for (const f of page.frames()) {
    for (const sel of sels) {
      const btn = f.locator(sel).first();
      if (await btn.count()) {
        try { await btn.click({ timeout: 6000 }); return true; } catch {}
      }
    }
  }
  return false;
}

/* ---------- Main ---------- */

(async () => {
  const browser = await chromium.launch({ headless: false }); // mets true en CI
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
  });

  // Pré-consent Axeptio (harmless si non présent)
  await ctx.addInitScript(() => {
    window._axcb = window._axcb || [];
    window._axcb.push((sdk) => {
      try {
        if (sdk && typeof sdk.acceptAll === "function") sdk.acceptAll();
        if (sdk?.consent && typeof sdk.consent.acceptAll === "function") sdk.consent.acceptAll();
      } catch {}
    });
  });

  const page = await ctx.newPage();

  // --- Mini log debug ---
  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), "=>", req.failure()?.errorText));
  page.on("frameattached", (f) => console.log("[frameattached]", f.url()));

  try {
    await page.goto("https://www.sanef.com/client/index.html?lang=fr#basket", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Souffle + attendre CMP
    try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch {}
    try {
      await Promise.race([
        page.waitForSelector('text="Ce site utilise des cookies"', { timeout: 5000 }),
        page.waitForSelector('iframe[src*="axeptio"]', { timeout: 5000 }),
        page.waitForSelector("#onetrust-banner-sdk", { timeout: 5000 }),
      ]);
    } catch {}

    await acceptAllCookiesEverywhere(page);
    try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch {}
    await page.waitForTimeout(300);

    // Input plaque
    const input = await findPlateInputEverywhere(page);
    if (!input) throw new Error("Input plaque introuvable.");
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click().catch(() => {});
    await input.fill("").catch(() => {});
    await input.type("AA123AA", { delay: 40 });

    // Bouton “Vérifier…”
    const clicked = await clickSubmitEverywhere(page);
    if (!clicked) console.warn("⚠️ Bouton de validation introuvable.");

    // Popin “Plus tard”
    try {
      await page.locator('[data-test-id="account-modal-cancel-button"], button:has-text("Plus tard")')
        .click({ timeout: 3000 });
    } catch {}

    try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}
    await page.waitForTimeout(800);

    // Screenshot pour vérifier visuellement
    await page.screenshot({ path: "local-sanef.png", fullPage: true });
    console.log("✅ Screenshot écrit: local-sanef.png");
  } catch (e) {
    console.error("❌ Erreur:", e.message);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
