// app/api/sanef/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import type { Page, Frame, Locator } from "playwright-core";

import path from "path";
import { launchBrowser } from "../_lib/browser";

// --- Consts ---

// User-Agent stable pour limiter les surprises
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";

// --- Helpers ---

function isProd() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

/**
 * Screenshot helper
 * - prod: retourne une data-URL base64 (pas d’écriture disque)
 * - dev : écrit dans /public et retourne "/<fichier>.png"
 */
async function snap(page: Page, filename: string): Promise<string> {
  if (isProd()) {
    const buf = await page.screenshot({ fullPage: true });
    return `data:image/png;base64,${buf.toString("base64")}`;
  } else {
    const full = path.join(process.cwd(), "public", filename);
    await page.screenshot({ path: full, fullPage: true });
    return `/${filename}`;
  }
}

// --- Cookies: Axeptio/OneTrust + variante "panneau bleu" Sanef ---
async function acceptAllCookiesEverywhere(page: Page): Promise<void> {
  // Laisse le panneau s’initialiser (animations)
  try {
    await page.waitForTimeout(800);
  } catch {}

  // 1) Variante "Sanef bleu" (locale / pas d'iframe)
  try {
    const panel = page.locator('text="Ce site utilise des cookies"').first();
    const btn = page.getByRole("button", { name: /^tout accepter$/i }).first();

    await Promise.race([
      panel.waitFor({ state: "visible", timeout: 7000 }),
      btn.waitFor({ state: "visible", timeout: 7000 }),
    ]).catch(() => {});

    try {
      await page.waitForTimeout(400);
    } catch {}

    if (await btn.count()) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await btn.click({ timeout: 6000, trial: true });
      } catch {}
      await btn.click({ timeout: 6000, force: true, noWaitAfter: true });
      try {
        await page.waitForLoadState("networkidle", { timeout: 3000 });
      } catch {}
      if (!(await panel.isVisible().catch(() => false))) return;
    }

    const maybe = await page.$('button:has-text("Tout accepter")');
    if (maybe) {
      const box = await maybe.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        try {
          await page.waitForLoadState("networkidle", { timeout: 3000 });
        } catch {}
        if (!(await panel.isVisible().catch(() => false))) return;
      }
    }
  } catch {}

  // 2) Axeptio (prod / autre parcours)
  try {
    const frameHandle = await page
      .waitForSelector('iframe[src*="axeptio"]', { timeout: 6000 })
      .catch(() => null);
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
          try {
            await page.waitForLoadState("networkidle", { timeout: 4000 });
          } catch {}
          return;
        }
      }
    }
  } catch {}

  // 3) OneTrust / Didomi (secours)
  try {
    const ot = page
      .locator("#onetrust-accept-btn-handler, button#accept-recommended-btn-handler")
      .first();
    if (await ot.count()) {
      await ot.click({ timeout: 6000, force: true });
      return;
    }
  } catch {}
  try {
    const didomi = page
      .frameLocator('iframe[src*="didomi"]')
      .locator('button:has-text("Tout accepter"), [data-qa="consent-agree-all"]')
      .first();
    if (await didomi.count()) {
      await didomi.click({ timeout: 6000, force: true });
      return;
    }
  } catch {}

  // 4) Dernier recours (dev)
  try {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document
        .querySelectorAll(
          '[class*="cookie"], [class*="consent"], #onetrust-banner-sdk, [id*="axeptio"]'
        )
        .forEach((el) => ((el as HTMLElement).style.display = "none"));
      (document.body as any).style.overflow = "auto";
      (document.body as any).style.pointerEvents = "auto";
    });
  } catch {}
}

// Cherche une fois (dans root) avec une liste de sélecteurs "classiques" ET Shadow DOM (css:light)
async function findPlateInput(root: Page | Frame): Promise<Locator | null> {
  const sels = [
    // ciblage direct
    'input[placeholder="XX123XX"]',
    'input[placeholder*="XX123" i]',
    '[data-test-id="page-basket-plate-input"] input',
    'input[name*="immatricul" i]',
    'input[name*="plaque" i]',
    'input[name*="plate" i]',

    // Shadow DOM (Playwright): css:light=…
    "css:light=input[placeholder=\"XX123XX\"]",
    'css:light=input[placeholder*="XX123" i]',
    "css:light=[data-test-id=\"page-basket-plate-input\"] input",
    'css:light=input[name*="immatricul" i]',
    'css:light=input[name*="plaque" i]',
    'css:light=input[name*="plate" i]',

    // fallback très large
    "css:light=input[type=\"text\"]",
    "css:light=input",
  ];

  for (const sel of sels) {
    const loc = root.locator(sel).first();
    try {
      // on donne un peu de temps au lazy-load
      await loc.waitFor({ state: "visible", timeout: 1500 });
      return loc;
    } catch {}
  }
  return null;
}

// Cherche sur la page ET dans toutes les iframes
async function findPlateInputEverywhere(page: Page): Promise<Locator | null> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {}

  const direct = await findPlateInput(page);
  if (direct) return direct;

  for (const frame of page.frames()) {
    const loc = await findPlateInput(frame);
    if (loc) return loc;
  }
  return null;
}

// Clique sur "Vérifier…" (page + iframes + Shadow DOM)
async function clickSubmitEverywhere(page: Page): Promise<boolean> {
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

  // page principale
  for (const sel of sels) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 6000 });
        return true;
      } catch {}
    }
  }

  // iframes
  for (const frame of page.frames()) {
    for (const sel of sels) {
      const btn = frame.locator(sel).first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 6000 });
          return true;
        } catch {}
      }
    }
  }
  return false;
}

// --- Route handler ---

export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("plate")?.trim() || "";
  if (!plate) {
    return Response.json({ ok: false, error: "missing plate" }, { status: 400 });
  }

  const ts = Date.now();
  const beforeName = `sanef-before-${ts}.png`;
  const afterName = `sanef-after-${ts}.png`;
  const errorName = `sanef-error-${ts}.png`;

  // 1) navigateur partagé
  const browser = await launchBrowser();

  // 2) context avec UA/locale/timezone
  const context = await browser.newContext({
    userAgent: UA,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // NOTE: pas de storageState en prod (FS en lecture seule sur Vercel)
  });

  // 2bis) pré-consent Axeptio (sans effet si non présent)
  await context.addInitScript(() => {
    (window as any)._axcb = (window as any)._axcb || [];
    (window as any)._axcb.push((sdk: any) => {
      try {
        if (sdk && typeof sdk.acceptAll === "function") sdk.acceptAll();
        if (sdk?.consent && typeof sdk.consent.acceptAll === "function")
          sdk.consent.acceptAll();
      } catch {}
    });
  });

  const page = await context.newPage();
// --- Mini log debug ---
page.on("console", msg => {
  console.log("[console]", msg.type(), msg.text());
});
page.on("pageerror", err => {
  console.log("[pageerror]", err.message);
});
page.on("requestfailed", req => {
  console.log("[requestfailed]", req.url(), "=>", req.failure()?.errorText);
});
page.on("frameattached", f => {
  console.log("[frameattached]", f.url());
});

  try {
    // viewport AVANT le goto
    await page.setViewportSize({ width: 1280, height: 900 });

    // 3) aller sur le panier Sanef
    await page.goto("https://www.sanef.com/client/index.html?lang=fr#basket", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    // laisser la page souffler
    try {
      await page.waitForLoadState("networkidle", { timeout: 4000 });
    } catch {}

    // attendre bannière + accepter cookies
    try {
      await Promise.race([
        page.waitForSelector('text="Ce site utilise des cookies"', { timeout: 5000 }),
        page.waitForSelector('iframe[src*="axeptio"]', { timeout: 5000 }),
        page.waitForSelector("#onetrust-banner-sdk", { timeout: 5000 }),
      ]);
    } catch {}
    await acceptAllCookiesEverywhere(page);

    // (re)stabilisation légère
    try {
      await page.waitForLoadState("networkidle", { timeout: 3000 });
    } catch {}
    await page.waitForTimeout(300);

    // Screenshot AVANT
    const beforePath = await snap(page, beforeName);

    // ---- TROUVER & REMPLIR LA PLAQUE ----
    const input = await findPlateInputEverywhere(page);
    if (!input) {
      const errPath = await snap(page, errorName);
      return Response.json(
        {
          ok: false,
          error: "Champ plaque introuvable (sélecteurs SANEF).",
          screenshot: errPath,
        },
        { status: 500 }
      );
    }
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click().catch(() => {});
    await input.fill("").catch(() => {});
    await input.type(plate, { delay: 40 });

    // ---- CLIQUER SUR “Vérifier mes péages à payer” ----
    const clicked = await clickSubmitEverywhere(page);
    if (!clicked) {
      const errPath = await snap(page, errorName);
      return Response.json(
        {
          ok: false,
          error: "Bouton de validation introuvable.",
          screenshot: errPath,
        },
        { status: 500 }
      );
    }

    // Fermer un éventuel popin de compte
    try {
      await page
        .locator(
          '[data-test-id="account-modal-cancel-button"], button:has-text("Plus tard")'
        )
        .click({ timeout: 3000 });
    } catch {}

    // Laisser l’UI se stabiliser un peu
    try {
      await page.waitForLoadState("networkidle", { timeout: 20_000 });
    } catch {}
    await page.waitForTimeout(1000);

    // Screenshot APRÈS
    const afterPath = await snap(page, afterName);

    // Réponse OK
    return Response.json({
      ok: true,
      plate,
      screenshots: { before: beforePath, after: afterPath },
      // si plus tard tu détectes un montant/URL détail/paiement, ajoute-les ici
    });
  } catch (e: any) {
    // En cas d'erreur, on tente une capture si possible
    let errPath: string | undefined;
    try {
      errPath = await snap(page, errorName);
    } catch {}
    return Response.json(
      { ok: false, error: e?.message || String(e), ...(errPath ? { screenshot: errPath } : {}) },
      { status: 500 }
    );
  } finally {
    // Toujours fermer proprement
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
