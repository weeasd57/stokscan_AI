// Probe the new keyless fallback sources directly (simulates Vercel block of DDG HTML)
const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
function decodeHtml(t) {
    return String(t || "")
        .replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;|&nbsp;/gi, m => HTML_ENTITIES[m.toLowerCase()] || m)
        .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const q = "توزيعات ارباح الاسهم البورصة المصرية";

// 1. DDG Instant Answer
const ia = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1&kl=eg-ar`, { headers: { "User-Agent": "stokscan-ai/1.0" } });
const iaData = await ia.json();
console.log("DDG Instant status:", ia.status, "| Heading:", iaData.Heading || "(none)", "| AbstractURL:", iaData.AbstractURL || "(none)", "| RelatedTopics:", (iaData.RelatedTopics || []).length);

// 2. Wikipedia ar
const wiki = await fetch(`https://ar.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`);
const wikiData = await wiki.json();
console.log("Wikipedia ar status:", wiki.status, "| hits:", (wikiData?.query?.search || []).length);
(wikiData?.query?.search || []).forEach(h => console.log("  -", decodeHtml(h.title)));

// 3. Wikipedia en with English query
const wikiEn = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent("Egyptian Exchange dividend distribution")}&srlimit=4&format=json&origin=*`);
const wikiEnData = await wikiEn.json();
console.log("Wikipedia en status:", wikiEn.status, "| hits:", (wikiEnData?.query?.search || []).length);
(wikiEnData?.query?.search || []).forEach(h => console.log("  -", decodeHtml(h.title)));
