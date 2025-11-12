import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // --- CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

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
      res
        .status(400)
        .json({ success: false, error: `Failed to fetch ${url} (${response.status})` });
      return;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const images = new Set();

    // --- AMAZON SPECIAL CASE ---
    if (url.includes("amazon.")) {
      const match = html.match(/"ImageBlockATF".*?(\{.*?\})\s*<\/script>/s);
      if (match) {
        try {
          const jsonStr = match[1];
          const parsed = JSON.parse(jsonStr);
          const mainImages = parsed.main || parsed.legacy || parsed.initial || [];
          mainImages.forEach((img) => {
            if (img && img.lg && img.lg.startsWith("https://"))
              images.add(img.lg);
            else if (typeof img === "string" && img.startsWith("https://"))
              images.add(img);
          });
        } catch (err) {
          console.warn("Amazon JSON parse error:", err.message);
        }
      }

      // fallback: try meta tags too
      $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
        const src = $(el).attr("content");
        if (src) images.add(src);
      });
    }

    // --- NORMAL SCRAPING ---
    $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
      const src = $(el).attr("content");
      if (src) images.add(new URL(src, url).href);
    });

    $("img").each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).attr("data-src") ||
        $(el).attr("data-lazy") ||
        $(el).attr("data-lazy-src");
      if (src) images.add(new URL(src, url).href);
    });

    $("source").each((_, el) => {
      const srcset = $(el).attr("srcset");
      if (srcset) {
        srcset.split(",").forEach((s) => {
          const clean = s.trim().split(" ")[0];
          if (clean) images.add(new URL(clean, url).href);
        });
      }
    });

    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr("style");
      if (!style) return;
      const matchBg = style.match(/url\(["']?(.*?)["']?\)/i);
      if (matchBg && matchBg[1]) images.add(new URL(matchBg[1], url).href);
    });

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const traverse = (obj) => {
          if (Array.isArray(obj)) obj.forEach(traverse);
          else if (typeof obj === "object" && obj !== null) {
            if (obj.image) {
              const addImage = (i) => {
                if (typeof i === "string") images.add(new URL(i, url).href);
                else if (i && typeof i === "object" && i.url)
                  images.add(new URL(i.url, url).href);
              };
              if (Array.isArray(obj.image)) obj.image.forEach(addImage);
              else addImage(obj.image);
            }
            Object.values(obj).forEach(traverse);
          }
        };
        traverse(json);
      } catch {}
    });

    res.status(200).json({ success: true, count: images.size, images: [...images] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
