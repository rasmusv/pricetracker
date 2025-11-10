import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());

app.get("/api/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: "Missing ?url parameter" });

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(() => {
      const img = document.querySelector("img");
      return {
        title: document.title,
        image: img ? img.src : null,
      };
    });

    await browser.close();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
