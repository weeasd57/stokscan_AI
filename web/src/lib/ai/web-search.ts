// Keyless web search used as a fallback when the requested information is not in
// the Supabase database. DuckDuckGo's HTML endpoint needs no API key; results
// are parsed into {title, snippet, url, domain} and must always be rendered
// with their sources so the user can verify them.

export interface WebSearchResult {
    title: string;
    snippet: string;
    url: string;
    domain: string;
}

const HTML_ENTITIES: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
    "&#x27;": "'", "&#39;": "'", "&nbsp;": " "
};

function decodeHtml(text: string): string {
    return text
        .replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;|&nbsp;/gi, m => HTML_ENTITIES[m.toLowerCase()] || m)
        .replace(/&#(\d+);/g, (_, code) => {
            try { return String.fromCharCode(Number(code)); } catch { return ""; }
        })
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// DuckDuckGo HTML links point at a redirect (/l/?uddg=<encoded url>) — unwrap it.
function unwrapDdgUrl(href: string): string {
    try {
        const normalized = href.startsWith("//") ? `https:${href}` : href;
        const uddg = new URL(normalized).searchParams.get("uddg");
        return uddg ? decodeURIComponent(uddg) : normalized;
    } catch {
        return href;
    }
}

function extractDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export async function searchWeb(query: string, limit = 5, timeoutMs = 10000): Promise<WebSearchResult[]> {
    if (!query || !query.trim()) return [];
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return [];
        const html = await res.text();

        // Each result block: <a class="result__a" href="...">title</a> ... <a class="result__snippet" ...>snippet</a>
        const blocks = html.split(/class="result__a"/).slice(1);
        const results: WebSearchResult[] = [];
        for (const block of blocks) {
            if (results.length >= limit) break;
            const linkMatch = block.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
            if (!linkMatch) continue;
            const url = unwrapDdgUrl(decodeHtml(linkMatch[1]));
            const title = decodeHtml(linkMatch[2]);
            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
            const snippet = snippetMatch ? decodeHtml(snippetMatch[1]) : "";
            if (!url.startsWith("http") || !title) continue;
            results.push({ title, snippet, url, domain: extractDomain(url) });
        }
        return results;
    } catch (e: any) {
        console.warn(`[WebSearch] Search failed for "${query}": ${e?.message || e}`);
        return [];
    }
}
