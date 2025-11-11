import * as cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) {
    res.status(400).json({ success: false, error: "Missing ?url=" });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PriceTrackerBot/1.0)" },
    });

    if (!response.ok) {
      res.status(400).json({ success: false, error: `Failed to fetch ${url}` });
      return;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const images = new Set();

    // 1. og:image / twitter:image
    $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
      const src = $(el).attr("content");
      if (src) images.add(new URL(src, url).href);
    });

    // 2. <img> tags (lazyload support)
    $("img").each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).attr("data-src") ||
        $(el).attr("data-lazy") ||
        $(el).attr("data-lazy-src");
      if (src) images.add(new URL(src, url).href);
    });

    // 3. <source srcset>
    $("source").each((_, el) => {
      const srcset = $(el).attr("srcset");
      if (srcset) {
        srcset.split(",").forEach((s) => {
          const clean = s.trim().split(" ")[0];
          if (clean) images.add(new URL(clean, url).href);
        });
      }
    });

    // 4. Inline background-image
    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr("style");
      const match = style.match(/url\\(["']?(.*?)["']?\\)/i);
      if (match && match[1]) images.add(new URL(match[1], url).href);
    });

    // 5. JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const findImages = (obj) => {
          if (Array.isArray(obj)) obj.forEach(findImages);
          else if (typeof obj === "object" && obj !== null) {
            if (obj.image) {
              if (Array.isArray(obj.image))
                obj.image.forEach((i) => images.add(new URL(i, url).href));
              else images.add(new URL(obj.image, url).href);
            }
            Object.values(obj).forEach(findImages);
          }
        };
        findImages(json);
      } catch {}
    });

    res.status(200).json({ success: true, count: images.size, images: [...images] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
