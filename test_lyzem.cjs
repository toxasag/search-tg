const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cheerio = require('cheerio');

async function test() {
  const query = "фриланс";
  const encodedQuery = encodeURIComponent(query);
  
  const testPages = [40, 41, 42, 43, 44, 45, 50, 100];
  
  for (const p of testPages) {
    const url = `https://lyzem.com/search?q=${encodedQuery}&p=${p}&per-page=100&f=all`;
    console.log(`\nFetching Page ${p}:`, url);
    
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results = $(".search-result");
      console.log(`Page ${p} returned ${results.length} elements.`);
      if (results.length > 0) {
        console.log(`  - First item: "${$(results[0]).find(".search-result-title").text().trim()}"`);
      }
    } catch (err) {
      console.error("Error on page", p, err);
    }
  }
}

test();
