const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/rasmusv/pricetracker/main/data/pricewatch.json";
const SCRAPER_URL = "https://pricetracker-scraper.vercel.app/api/scrape-images";

export default async function handler(req, res) {
  try {
    // 1. Fetch existing JSON from GitHub
    const response = await fetch(GITHUB_JSON_URL);
    if (!response.ok) throw new Error("Failed to fetch pricewatch.json");

    const data = await response.json();
    if (!data.products || !Array.isArray(data.products)) {
      throw new Error("pricewatch.json must contain a 'products' array");
    }

    const updatedProducts = [];
    let updatedCount = 0;

    // 2. Loop through each product
    for (const product of data.products) {
      if (!product.image_url || product.image_url === null || product.image_url.trim?.() === "") {
        try {
          // Try to find image for this product
          const scrapeRes = await fetch(
            `${SCRAPER_URL}?url=${encodeURIComponent(product.product_url)}`
          );
          const scrapeData = await scrapeRes.json();

          if (scrapeData.success && Array.isArray(scrapeData.images) && scrapeData.images.length > 0) {
            product.image_url = scrapeData.images[0];
            updatedCount++;
            console.log(`✅ ${product.product_name} → ${product.image_url}`);
          } else {
            console.log(`❌ No image found for ${product.product_name}`);
          }
        } catch (err) {
          console.error(`Scrape failed for ${product.product_name}:`, err.message);
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
      products: enriched.products,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
