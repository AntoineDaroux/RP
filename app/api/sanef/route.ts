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

// 6) trouver et remplir la plaque (sélecteurs robustes + fallbacks)
const candidates = [
  page.getByPlaceholder("XX123XX"),
  page.locator('[data-test-id="page-basket-plate-input"] input'),
  page.locator('input[name*="plaque"], input[name*="plate"], input[name*="license"]'),
  page.locator('input[placeholder*="XX"][placeholder*="123"]'),
  page.getByRole("textbox")
];

let input: import("playwright-core").Locator | null = null;
for (const c of candidates) {
  const el = c.first();
  if ((await el.count()) > 0) {
    input = el;
    break;
  }
}
if (!input) {
  throw new Error("Champ plaque introuvable (sélecteurs SANEF).");
}

// s'assurer qu'il est à l'écran + visible
await input.scrollIntoViewIfNeeded().catch(() => {});
await input.waitFor({ state: "visible", timeout: 20_000 });

// certains placeholders disparaissent, on nettoie puis on remplit
await input.click({ timeout: 5_000 }).catch(() => {});
await input.fill("", { timeout: 5_000 }).catch(() => {});
await input.fill(plate, { timeout: 8_000 }).catch(async () => {
  // fallback si fill échoue
  await input.type(plate, { delay: 40 });
});

// 7) bouton “Vérifier mes péages à payer” – plusieurs sélecteurs
const submit = page.locator(
  '[data-test-id="page-basket-submit-button"], ' +
  'button:has-text("Vérifier"), button:has-text("payer"), button:has-text("Rechercher")'
).first();
if ((await submit.count()) === 0) {
  throw new Error("Bouton de soumission introuvable.");
}
await submit.click({ timeout: 10_000 }).catch(() => submit.dispatchEvent("click"));

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
