import { chromium } from "@playwright/test";

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: "Missing ?url parameter" });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const image =
      (await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null)) ||
      (await page.$eval('meta[name="twitter:image"]', el => el.content).catch(() => null)) ||
      (await page.$eval("img", el => el.src).catch(() => null));

    const title = await page.title();
    await browser.close();

    res.status(200).json({ success: true, title, image });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: err.message });
  }
}
