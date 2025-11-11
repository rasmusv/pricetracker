const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/rasmusv/pricetracker/main/data/pricewatch.json";
const SCRAPER_URL = "https://pricetracker-opal.vercel.app/api/scrape-images";

export default async function handler(req, res) {
  try {
    // 1. Load JSON from GitHub
    const response = await fetch(GITHUB_JSON_URL);
    if (!response.ok) throw new Error("Failed to fetch pricewatch.json");

    const data = await response.json();
    if (!data.products || !Array.isArray(data.products)) {
      throw new Error("pricewatch.json must contain a 'products' array");
    }

    const updatedProducts = [];
    let updatedCount = 0;

    // 2. Iterate through all products
    for (const product of data.products) {
      const productId = product.id || "(no id)";
      const url = product.url || product.product_url;

      if (!url) {
        console.warn(`⚠️ Product ${productId} has no URL, skipping`);
        updatedProducts.push(product);
        continue;
      }

      if (!product.image_url || !product.image_url.trim?.()) {
        try {
          const scrapeRes = await fetch(
            `${SCRAPER_URL}?url=${encodeURIComponent(url)}`
          );
          const scrapeData = await scrapeRes.json();

          if (scrapeData.success && Array.isArray(scrapeData.images) && scrapeData.images.length > 0) {
            product.image_url = scrapeData.images[0];
            updatedCount++;
            console.log(`✅ ${productId} → ${product.image_url}`);
          } else {
            console.log(`❌ No images found for ${productId}`);
          }
        } catch (err) {
          console.error(`❌ Error scraping ${productId}:`, err.message);
        }
      }

      updatedProducts.push(product);
    }

    // 3. Return updated structure
    const enriched = { ...data, products: updatedProducts };

    res.status(200).json({
      success: true,
      total: data.products.length,
      updated: updatedCount,
      products: enriched.products.map((p) => ({
        id: p.id,
        product_name: p.product_name,
        image_url: p.image_url || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
