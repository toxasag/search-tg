const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function test() {
  try {
    const res = await fetch("http://localhost:3000/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "фриланс", source: "tgramsearch", mode: "fast", limitPages: "1" })
    });
    const data = await res.json();
    console.log("Stats:", JSON.stringify(data.searchStats, null, 2));
    if (data.results && data.results.length > 0) {
      console.log("Sample result telegram URLs:");
      console.log(data.results.slice(0, 5).map(r => r.telegramUrl));
    }
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
test();
