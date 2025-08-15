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
// --- Helpers complémentaires (recherche dans page + iframes) ---

// --- Cookies: clique partout (page, iframes, shadow DOM), sinon enlève l’overlay ---
async function acceptAllCookiesEverywhere(page: Page): Promise<void> {
  // essais directs (page)
  const direct = [
    page.getByRole('button', { name: /tout accepter/i }),
    page.locator('button:has-text("Tout accepter")'),
    page.locator('#axeptio_btn_acceptAll, [data-ax-accept], [data-testid*="accept-all"]'),
    page.locator('[id*="accept"][id*="all"]'),
    // Shadow DOM
    page.locator('css:light=#axeptio_btn_acceptAll'),
    page.locator('css:light=button:has-text("Tout accepter")'),
  ];

  for (const loc of direct) {
    if (await loc.count()) {
      try {
        const btn = loc.first();
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 1500, force: true });
        return;
      } catch {}
    }
  }

  // iframes
  for (const f of page.frames()) {
    const inFrame = [
      f.getByRole('button', { name: /tout accepter/i }),
      f.locator('button:has-text("Tout accepter")'),
      f.locator('#axeptio_btn_acceptAll, [data-ax-accept], [data-testid*="accept-all"]'),
      f.locator('[id*="accept"][id*="all"]'),
    ];
    for (const loc of inFrame) {
      if (await loc.count()) {
        try { await loc.first().click({ timeout: 1500, force: true }); return; } catch {}
      }
    }
  }

  // bruteforce par coordonnées (si on trouve un noeud texte)
  try {
    const el = await page.$('text=/tout accepter/i');
    const box = el && await el.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  } catch {}

  // dernier recours: on masque l’overlay
  try {
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document
        .querySelectorAll('[id*=axeptio],[class*="cookie"],[class*="consent"]')
        .forEach(el => (el as HTMLElement).style.display = 'none');
      document.body.style.overflow = 'auto';
      document.body.style.pointerEvents = 'auto';
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
    'css:light=input[placeholder="XX123XX"]',
    'css:light=input[placeholder*="XX123" i]',
    'css:light=[data-test-id="page-basket-plate-input"] input',
    'css:light=input[name*="immatricul" i]',
    'css:light=input[name*="plaque" i]',
    'css:light=input[name*="plate" i]',

    // fallback très large
    'css:light=input[type="text"]',
    'css:light=input',
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
  // attendre que quelque chose arrive dans le DOM
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}

  // essai direct
  const direct = await findPlateInput(page);
  if (direct) return direct;

  // essai dans les iframes (certaines sont shadow + iframe…)
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
    'css:light=[data-test-id="page-basket-submit-button"]',
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
      try { await btn.click({ timeout: 1500 }); return true; } catch {}
    }
  }

  // iframes
  for (const frame of page.frames()) {
    for (const sel of sels) {
      const btn = frame.locator(sel).first();
      if (await btn.count()) {
        try { await btn.click({ timeout: 1500 }); return true; } catch {}
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
await page.setViewportSize({ width: 1280, height: 900 });

// laisser la page souffler un peu
try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}

// Cookies : essayer partout
await acceptAllCookiesEverywhere(page);

// (re)stabilisation légère
try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch {}
await page.waitForTimeout(300);

// Screenshot AVANT
const beforePath = await snap(page, beforeName);

// ---- TROUVER & REMPLIR LA PLAQUE (page ou iframe) ----
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

// ---- CLIQUER SUR “Vérifier mes péages à payer” ----
const clicked = await clickSubmitEverywhere(page);
if (!clicked) {
  const errPath = await snap(page, errorName);
  await context.close(); await browser.close();
  return Response.json(
    { ok: false, error: "Bouton de validation introuvable.", screenshot: errPath },
    { status: 500 }
  );
}

// Fermer un éventuel popin de compte
try {
  await page
    .locator('[data-test-id="account-modal-cancel-button"], button:has-text("Plus tard")')
    .click({ timeout: 3_000 });
} catch {}

// Laisser l’UI se stabiliser un peu
try { await page.waitForLoadState("networkidle", { timeout: 20_000 }); } catch {}
await page.waitForTimeout(1_000);

// Screenshot APRÈS
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
