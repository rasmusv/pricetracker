const { chromium } = require('playwright');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const MIN_IMAGE_BYTES = 10240; // 10 KB
const NAV_TIMEOUT = 10000; // 10s

function pickLargestFromSrcset(srcset) {
  try {
    return srcset.split(',')
      .map(s => s.trim().split(/\s+/))
      .map(([url, desc]) => {
        const w = desc && desc.endsWith('w') ? parseInt(desc.slice(0, -1), 10) : (desc && desc.endsWith('x') ? parseFloat(desc.slice(0,-1)) : 1);
        return { url, w: isNaN(w)?1:w };
      })
      .sort((a,b)=>b.w-a.w)[0].url;
  } catch (e) { return null; }
}

async function headCheckImage(imgUrl) {
  try {
    const res = await fetch(imgUrl, { method: 'HEAD', redirect: 'follow' });
    return {
      ok: res.ok,
      type: res.headers.get('content-type'),
      length: parseInt(res.headers.get('content-length') || '0', 10),
      status: res.status
    };
  } catch (e) {
    return { ok: false };
  }
}

async function downloadImageAsBase64(imgUrl) {
  const res = await fetch(imgUrl, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('Failed GET ' + res.status);
  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const b64 = buf.toString('base64');
  return { base64: `data:${ct};base64,${b64}`, size: buf.length, type: ct };
}

module.exports = async (req, res) => {
  const url = (req.method === 'GET') ? req.query.url || '' : (req.body && req.body.url);
  if (!url) {
    res.status(400).json({ success: false, error: 'Missing url parameter' });
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'], headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // extract candidates
    const candidates = await page.evaluate(() => {
      const urls = [];
      const add = v => { if (v) urls.push(v); };
      const og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) add(og);
      const og2 = document.querySelector('meta[property="og:image:secure_url"]')?.content;
      if (og2) add(og2);
      const tw = document.querySelector('meta[name="twitter:image"]')?.content;
      if (tw) add(tw);
      const link = document.querySelector('link[rel="image_src"]')?.href;
      if (link) add(link);
      // picture/srcset
      const pictures = Array.from(document.querySelectorAll('picture source[srcset], source[srcset]'));
      for (const p of pictures) {
        add(p.getAttribute('srcset'));
      }
      // img with src/data-src/etc
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        add(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-srcset') || img.getAttribute('data-original'));
        if (img.src) add(img.src);
        if (img.srcset) add(img.srcset);
      }
      // background images
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        try {
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none') {
            const m = bg.match(/url\(["']?(.*?)["']?\)/);
            if (m && m[1]) add(m[1]);
          }
        } catch (e) {}
      }
      // normalize unique
      return Array.from(new Set(urls));
    });

    // normalize srcset entries (pick largest)
    const normalized = [];
    for (const c of candidates) {
      if (!c) continue;
      if (c.includes(',')) {
        const pick = (function(srcset){ 
          try {
            return srcset.split(',').map(s=>s.trim()).map(part=>part.split(/\s+/)[0]).pop();
          } catch(e){ return null; }
        })(c);
        if (pick) normalized.push(pick);
      } else {
        normalized.push(c);
      }
    }

    // resolve relative URLs
    const pageUrl = new URL(url);
    const resolved = normalized.map(u => {
      try { return new URL(u, pageUrl).toString(); } catch(e){ return null; }
    }).filter(Boolean);

    // try candidates with HEAD then GET
    for (const imgUrl of resolved) {
      const head = await headCheckImage(imgUrl);
      if (!head.ok) continue;
      if (!head.type || !head.type.startsWith('image/')) continue;
      if (head.length && head.length < MIN_IMAGE_BYTES) continue;
      try {
        const dl = await downloadImageAsBase64(imgUrl);
        await browser.close();
        res.json({ success: true, image_url: imgUrl, base64: dl.base64, size: dl.size, type: dl.type });
        return;
      } catch (e) {
        // continue to next
      }
    }

    await browser.close();
    res.status(404).json({ success: false, error: 'No valid image found' });
    return;

  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: err.message });
    return;
  }
};
