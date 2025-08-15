// test-sanef.js
const { chromium } = require('playwright');

(async () => {
  // lance un vrai Chrome visible pour mimer un utilisateur
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    locale: 'fr-FR',
  });

  // Va sur la page SANEF
  await page.goto('https://www.sanef.com/client/index.html?lang=fr#basket', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Laisse respirer (Cloudflare, etc.)
  await page.waitForTimeout(8000);

  // Fais une capture pour vérifier ce qui s'affiche
  await page.screenshot({ path: 'sanef-test.png', fullPage: true });

  // ferme le navigateur
  await browser.close();
})();
