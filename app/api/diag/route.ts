// app/api/_diag/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import chromium from "@sparticuz/chromium";
import { launchBrowser } from "../_lib/browser";

export async function GET() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  let exe = await chromium.executablePath();

  try {
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    const png = await page.screenshot({ fullPage: true, type: "png" });
    const b64 = Buffer.from(png).toString("base64");
    return new Response(JSON.stringify({
      ok: true,
      executablePath: exe,
      screenshot: `data:image/png;base64,${b64}`
    }, null, 2), { headers: { "content-type": "application/json" }});
  } catch(e:any) {
    return new Response(JSON.stringify({ ok:false, executablePath: exe, error: e?.message }, null, 2),
      { status: 500, headers: { "content-type": "application/json" }});
  } finally {
    await browser.close().catch(()=>{});
  }
}
