// app/api/_diag/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { launchBrowser } from "../_lib/browser";

export async function GET() {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  const page = await context.newPage();

  try {
    // délai un peu plus large, et attente tolérante
    await page.goto("https://example.com/", {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });

    const png = await page.screenshot({ fullPage: true });
    const b64 = png.toString("base64");

    return new Response(
      JSON.stringify(
        {
          ok: true,
          engine: "playwright-core chromium",
          screenshot: `data:image/png;base64,${b64}`,
        },
        null,
        2
      ),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    // si ça timeoute, on renvoie quand même une capture si possible
    const shot = await page.screenshot({ fullPage: true }).catch(() => null);
    return new Response(
      JSON.stringify(
        {
          ok: false,
          engine: "playwright-core chromium",
          error: e?.message || String(e),
          screenshot: shot ? `data:image/png;base64,${shot.toString("base64")}` : undefined,
        },
        null,
        2
      ),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
