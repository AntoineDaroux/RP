// app/api/sanef/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import type { Page } from "playwright-core";
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
// --- Helpers complémentaires (recherche dans page + iframes) ---
import type { Frame, Locator } from "playwright-core";

async function findPlateInput(root: Page | Frame): Promise<Locator | null> {
  const selectors = [
    'input[placeholder="XX123XX"]',
    'input[placeholder*="XX123" i]',
    '[data-test-id="page-basket-plate-input"] input',
    'input[name*="immatricul" i]',
    'input[name*="plaque" i]',
    'input[name*="plate" i]',
    'input[type="text"]',
    'input',
  ];
  for (const sel of selectors) {
    const loc = root.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: 800 });
      return loc;
    } catch {}
  }
  return null;
}

async function findPlateInputEverywhere(page: Page): Promise<Locator | null> {
  const direct = await findPlateInput(page);
  if (direct) return direct;

  for (const frame of page.frames()) {
    const loc = await findPlateInput(frame);
    if (loc) return loc;
  }
  return null;
}

async function clickSubmitEverywhere(page: Page): Promise<boolean> {
  const selectors = [
    '[data-test-id="page-basket-submit-button"]',
    'button:has-text("Vérifier")',
    'button:has-text("payer")',
    'button:has-text("Rechercher")',
    'button:visible',
  ];

  // d’abord sur la page
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 1200 }); return true; } catch {}
    }
  }

  // puis dans les iframes
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const btn = frame.locator(sel).first();
      if (await btn.count()) {
        try { await btn.click({ timeout: 1200 }); return true; } catch {}
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
  const afterName  = `sanef-after-${ts}.png`;
  const errorName  = `sanef-error-${ts}.png`;

  // 1) navigateur partagé
  const browser = await launchBrowser();

  // 2) on crée un context pour fixer UA/locale/timezone (mieux que page.setUserAgent)
  const context = await browser.newContext({
    userAgent: UA,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // NOTE: pas de storageState en prod (FS en lecture seule sur Vercel) ; 
    // si tu as un sanef-state.json en local, tu peux l’ajouter ici côté dev.
  });

  const page = await context.newPage();

  try {
    // 3) aller sur le panier Sanef
    await page.goto("https://www.sanef.com/client/index.html?lang=fr#basket", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    // (facultatif) Si une protection Cloudflare apparaît, on peut juste attendre un peu :
    try {
      // si la page met du temps à stabiliser, on laisse respirer
      await page.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch {}

    // 4) capture AVANT
    const beforePath = await snap(page, beforeName);

    // 5) cookies – on essaie plusieurs variantes
try {
  // Bouton “Tout accepter” (texte FR ou data-test)
  const cookieBtn = page.locator(
    'button:has-text("Tout accepter"), ' +
    '[data-test-id="accept-all"], ' +
    '[id*="accept"][id*="all"]'
  ).first();
  if (await cookieBtn.count()) {
    await cookieBtn.click({ timeout: 3_000 }).catch(() => {});
  }
} catch {}

// 6) TROUVER & REMPLIR LA PLAQUE (page ou iframe)
const input = await findPlateInputEverywhere(page);
if (!input) {
  const errPath = await snap(page, errorName);
  await context.close(); await browser.close();
  return Response.json(
    { ok: false, error: "Champ plaque introuvable (sélecteurs SANEF).", screenshot: errPath },
    { status: 500 }
  );
}

await input.scrollIntoViewIfNeeded().catch(() => {});
await input.click().catch(() => {});
await input.fill("").catch(() => {});
await input.type(plate, { delay: 40 });

// 7) CLIQUER SUR “Vérifier…” (page ou iframe)
const clicked = await clickSubmitEverywhere(page);
if (!clicked) {
  const errPath = await snap(page, errorName);
  await context.close(); await browser.close();
  return Response.json(
    { ok: false, error: "Bouton de validation introuvable.", screenshot: errPath },
    { status: 500 }
  );
}


// 8) fermer un éventuel popin de compte
try {
  await page.locator('[data-test-id="account-modal-cancel-button"], button:has-text("Plus tard")')
    .click({ timeout: 3_000 });
} catch {}

// 9) attendre la stabilisation réseau/DOM
try { await page.waitForLoadState("networkidle", { timeout: 20_000 }); } catch {}
await page.waitForTimeout(1_000);


    // 10) capture APRÈS
    const afterPath = await snap(page, afterName);

    await context.close();
    await browser.close();

    return Response.json({
      ok: true,
      plate,
      screenshots: { before: beforePath, after: afterPath },
      // si plus tard tu détectes un montant/URL détail/paiement, ajoute-les ici
    });
  } catch (e: any) {
    // capture d’erreur (utile en dev – en prod renverra une data-URL)
    try { 
      const errPath = await snap(page, errorName);
      await context.close();
      await browser.close();
      return Response.json({ ok: false, error: e?.message || String(e), screenshot: errPath }, { status: 500 });
    } catch {
      await context.close();
      await browser.close();
      return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
  }
}
