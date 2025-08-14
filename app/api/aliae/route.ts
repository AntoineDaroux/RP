export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { launchBrowser } from "../_lib/browser";
import path from "path";

function parseAmountToCents(txt: string): number | null {
  const m = txt.replace(/\s/g, "").match(/([0-9]+)[\.,]([0-9]{1,2})/);
  if (!m) return null;
  const euros = parseInt(m[1], 10);
  const cents = parseInt(m[2].padEnd(2, "0"), 10);
  return euros * 100 + cents;
}

export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("plate")?.trim() || "";
  if (!plate) return Response.json({ ok: false, error: "missing plate" }, { status: 400 });

  const ts = Date.now();
  const before = `aliae-before-${ts}.png`;
  const after  = `aliae-after-${ts}.png`;

  // dev vs prod
  const isProd =
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.NODE_ENV === "production";

  const browser = await launchBrowser();
  const page = await browser.newPage({ locale: "fr-FR", timezoneId: "Europe/Paris" });

  // petit helper pour faire un screenshot utilisable en dev/production
  async function snap(filename: string) {
  if (isProd) {
    const buffer = await page.screenshot({ fullPage: true });
    const b64 = buffer.toString("base64");
    return `data:image/png;base64,${b64}`;
  } else {
    const full = path.join(process.cwd(), "public", filename);
    await page.screenshot({ path: full, fullPage: true });
    return `/${filename}`;
  }
}

  try {
    await page.goto("https://paiement.aliae.com/fr/form/payment", { waitUntil: "domcontentloaded", timeout: 60000 });

    // cookies
    try { await page.getByRole("button", { name: /autoriser tous les cookies/i }).click({ timeout: 3000 }); } catch {}

    const beforeHref = await snap(before);

    // remplir la plaque
    await page.getByRole("button", { name: /Plaque d'immatriculation/i }).click();
    await page.getByRole("textbox").fill(plate);

    // pays FR si présent
    try {
      await page.locator("#mat-input-0").click({ timeout: 3000 });
      await page.getByRole("option", { name: "France" }).click({ timeout: 3000 });
    } catch {}

    // valider + continuer si présent
    try { await page.getByRole("button", { name: /Valider/i }).click({ timeout: 3000 }); } catch {}
    try { await page.getByRole("button", { name: /Continuer/i }).click({ timeout: 3000 }); } catch {}

    // attendre stabilisation
    try { await page.waitForLoadState("networkidle", { timeout: 12000 }); } catch {}
    await page.waitForTimeout(800);

    // Détecter "aucun trajet"
    let noTrip = false;
    try {
      noTrip = await page.getByText(/n'avons pas trouvé de trajet associé à cette plaque/i)
        .first().isVisible({ timeout: 2000 });
    } catch {}

    // Tenter de détecter un montant dû
    let amountTxt: string | null = null;
    const candidates = [
      '[class*="amount"]', '[class*="total"]', '[data-testid*="amount"]', 'text=/€|EUR/i'
    ];
    for (const sel of candidates) {
      const el = await page.locator(sel).first();
      if (await el.count()) {
        const t = (await el.textContent())?.trim() || "";
        if (/[0-9][\.,][0-9]{1,2}/.test(t)) { amountTxt = t; break; }
      }
    }
    const amountCents = amountTxt ? parseAmountToCents(amountTxt) : null;

    // Tenter de trouver le bouton Payer
    let payHref: string | undefined;
    const linkCands = [
      page.getByRole("link", { name: /payer|paiement|régler/i }),
      page.getByRole("button", { name: /payer|paiement|régler/i }),
      page.locator('a[href*="pay" i], a[href*="paiement" i], a[href*="checkout" i]')
    ];
    for (const cand of linkCands) {
      try {
        const el = cand.first();
        if (await el.count()) {
          const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => "");
          if (tag === "a") {
            const href = await el.getAttribute("href");
            if (href) { payHref = href; break; }
          }
        }
      } catch {}
    }

    const resultUrl = page.url();
    const afterHref = await snap(after);

    // Aucun dû détecté ?
    if (noTrip || (!amountCents && !payHref)) {
      return Response.json({
        ok: true,
        hasDue: false,
        plate,
        screenshots: { before: beforeHref, after: afterHref }, // dataURL en prod, /fichier en local
      });
    }

    // Dû détecté
    return Response.json({
      ok: true,
      hasDue: true,
      plate,
      amountDue: amountCents ?? undefined,
      currency: "EUR",
      resultUrl,                   // pour “Voir détails”
      payUrl: payHref || resultUrl, // fallback
      screenshots: { before: beforeHref, after: afterHref },
    });

  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}
