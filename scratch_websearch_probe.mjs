// Scratch: verify keyless web-search sources are reachable before wiring them
// into the chatbot (DuckDuckGo HTML + Wikipedia REST summary).
const q = encodeURIComponent("مطاحن الإسكندرية AFMC");

try {
    const t0 = Date.now();
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(12000)
    });
    const html = await r.text();
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5)
        .map(m => ({ href: m[1].slice(0, 120), title: m[2].replace(/<[^>]+>/g, "").trim().slice(0, 80) }));
    console.log("DDG:", r.status, `${Date.now() - t0}ms`, "results:", links.length);
    console.log(JSON.stringify(links, null, 1).slice(0, 800));
} catch (e) {
    console.log("DDG FAILED:", e.message);
}

try {
    const t0 = Date.now();
    const sr = await fetch(`https://ar.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&srlimit=3`, {
        headers: { "User-Agent": "EGXBots/1.0" },
        signal: AbortSignal.timeout(12000)
    });
    const sj = await sr.json();
    console.log("WIKI:", sr.status, `${Date.now() - t0}ms`, (sj.query?.search || []).map(s => s.title));
} catch (e) {
    console.log("WIKI FAILED:", e.message);
}
