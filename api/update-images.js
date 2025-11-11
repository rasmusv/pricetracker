const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/rasmusv/pricetracker/main/data/pricewatch.json";

// TODO: replace <YOUR_VERCEL_APP> with your actual Vercel project hostname.
// Example: https://pricetracker-scraper.vercel.app/api/scrape-images
const SCRAPER_URL = "https://pricetracker-opal.vercel.app/api/scrape-images";

export default async function handler(req, res) {
  try {
    const response = await fetch(GITHUB_JSON_URL);
    if (!response.ok) throw new Error("Failed to fetch pricewatch.json");

    const products = await response.json();
    if (!Array.isArray(products)) {
      throw new Error("Expected an array in pricewatch.json");
    }

    const updatedProducts = [];
    let updatedCount = 0;

    for (const product of products) {
      // assume fields: url, image_url (adjust if your schema differs)
      if (!product.image_url || !product.image_url.trim()) {
        try {
          const scrapeRes = await fetch(
            `${SCRAPER_URL}?url=${encodeURIComponent(product.url)}`
          );
          const data = await scrapeRes.json();

          if (data.success && Array.isArray(data.images) && data.images.length > 0) {
            product.image_url = data.images[0];
            updatedCount += 1;
          }
        } catch (e) {
          // ignore single item errors, continue with others
        }
      }
      updatedProducts.push(product);
    }

    res.status(200).json({
      success: true,
      total: products.length,
      updated: updatedCount,
      products: updatedProducts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
