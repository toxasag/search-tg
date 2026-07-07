const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testSearch() {
  const payload = {
    query: "фриланс",
    source: "lyzem",
    mode: "fast",
    limitPages: 100
  };

  try {
    const res = await fetch("http://localhost:3000/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("Stats:", data.searchStats);
    console.log("Total results found in results array:", data.results.length);
    console.log("\nLogs:");
    console.log(data.logs.slice(0, 30).join("\n"));
    console.log("...");
    console.log(data.logs.slice(-20).join("\n"));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

testSearch();
