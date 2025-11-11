export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url=");

  try {
    const imageRes = await fetch(url);
    if (!imageRes.ok) {
      return res.status(400).send(`Failed to fetch image: ${imageRes.status}`);
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).send("Error fetching image: " + err.message);
  }
}
