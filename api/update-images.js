const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/rasmusv/pricetracker/main/data/pricewatch.json";

const SCRAPER_URL = "https://pricetracker-opal.vercel.app/api/scrape-images";

export default async function handler(req, res) {
  try {
    const response = await fetch(GITHUB_JSON_URL, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pricewatch.json (${response.status})`);
    }

    const root = await response.json();

    // sinu struktuur: { exported_at, total_users, data: { products, listings, tracked_products }, stats }
    const container = root.data;
    if (!container || !Array.isArray(container.products)) {
      throw new Error("pricewatch.json: data.products is missing or not an array");
    }

    const products = container.products;
    const listings = Array.isArray(container.listings) ? container.listings : [];

    // Ehita indeks: product_id -> listings[]
    const listingsByProductId = new Map();
    for (const listing of listings) {
      if (!listing.product_id) continue;
      if (!listingsByProductId.has(listing.product_id)) {
        listingsByProductId.set(listing.product_id, []);
      }
      listingsByProductId.get(listing.product_id).push(listing);
    }

    let updatedCount = 0;

    for (const product of products) {
      const productId = product.id || "(no id)";

      // Kui pilt juba olemas ja mitte tühi, jäta rahule
      if (product.image_url && product.image_url.trim?.()) {
        continue;
      }

      // Leia seotud listing (võta esimene)
      const productListings = listingsByProductId.get(product.id);
      const url = productListings?.[0]?.url;

      if (!url) {
        console.warn(`⚠️ Product ${productId} has no listing URL, skipping`);
        continue;
      }

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
          console.log(`❌ No images for ${productId}`);
        }
      } catch (err) {
        console.error(`❌ Error scraping ${productId}:`, err.message);
      }
    }

    // Vastus – ei kirjuta GitHubi tagasi, lihtsalt annab enriched data välja
    res.status(200).json({
      success: true,
      total: products.length,
      updated: updatedCount,
      products: products.map((p) => ({
        id: p.id,
        product_name: p.product_name,
        image_url: p.image_url || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
