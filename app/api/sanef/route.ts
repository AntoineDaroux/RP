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
      timeout: 60_000,
    });

    // (facultatif) Si une protection Cloudflare apparaît, on peut juste attendre un peu :
    try {
      // si la page met du temps à stabiliser, on laisse respirer
      await page.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch {}

    // 4) capture AVANT
    const beforePath = await snap(page, beforeName);

    // 5) cookies
    try {
      await page.getByRole("button", { name: /tout accepter/i }).click({ timeout: 2_500 });
    } catch {}

    // 6) remplir la plaque
    // d’après l’UI actuelle : placeholder "XX123XX"
    const input = page.locator('input[placeholder="XX123XX"]').first();
    await input.waitFor({ state: "visible", timeout: 8_000 });
    await input.fill(plate);

    // 7) bouton "Vérifier mes péages à payer"
    await page.locator('[data-test-id="page-basket-submit-button"]').click();

    // 8) fermer un éventuel popin "créer/connexion compte"
    try {
      await page.locator('[data-test-id="account-modal-cancel-button"]').click({ timeout: 3_000 });
    } catch {}

    // 9) attendre que l’UI soit stable
    try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch {}
    await page.waitForTimeout(1_200);

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
