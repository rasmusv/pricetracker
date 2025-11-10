import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ success: false, error: "Missing ?url parameter" });
    }

    const executablePath = await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
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
  } catch (error) {
    console.error("Scrape error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
