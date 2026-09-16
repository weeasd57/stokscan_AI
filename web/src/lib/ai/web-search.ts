// Keyless web search used as a fallback when the requested information is not in
// the Supabase database. DuckDuckGo's HTML endpoint needs no API key; results
// are parsed into {title, snippet, url, domain} and must always be rendered
// with their sources so the user can verify them.

import { getExecutionSignal } from "./execution";

export interface WebSearchResult {
    title: string;
    snippet: string;
    url: string;
    domain: string;
    published_at?: string | null;
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

export async function searchWeb(query: string, limit = 5, timeoutMs = 4000, signal?: AbortSignal): Promise<WebSearchResult[]> {
    signal = signal ?? getExecutionSignal();
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (!query || !query.trim()) return [];
    // One deadline for the entire fallback chain, including response bodies.
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onParentAbort, { once: true });
    const timeoutId = setTimeout(() => controller.abort(new DOMException("Web search timed out", "TimeoutError")), Math.max(0, timeoutMs));
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const run = async () => {
        let lastError: unknown;
        const providers = [searchDdgHtml, searchGoogleNewsRss, searchDdgInstant,
            (q: string, n: number, s: AbortSignal) => searchWikipedia(q, n, s, "ar"),
            (q: string, n: number, s: AbortSignal) => searchWikipedia(q, n, s, "en")];
        for (const provider of providers) {
            if (controller.signal.aborted) throw controller.signal.reason;
            try {
                const results = await provider(query, limit, controller.signal);
                if (controller.signal.aborted) throw controller.signal.reason;
                if (results.length > 0) return results;
            } catch (error) {
                if (controller.signal.aborted) throw controller.signal.reason;
                lastError = error;
            }
        }
        // A failed/partial lookup is not a confirmed empty lookup. Callers can
        // retry it instead of poisoning their negative cache on network errors.
        if (lastError) throw lastError;
        return [];
    };
    try {
        return await Promise.race([run(), cancelled]);
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onParentAbort);
        controller.signal.removeEventListener("abort", onAbort);
    }
}

async function searchDdgHtml(query: string, limit: number, signal: AbortSignal): Promise<WebSearchResult[]> {
    try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
            signal
        });
        if (!res.ok) throw new Error(`DDG HTML HTTP ${res.status}`);
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
        console.warn(`[WebSearch] DDG HTML failed for "${query}": ${e?.message || e}`);
        throw e;
    }
}

// Google News RSS — keyless, datacenter-friendly, and ideal for news-style
// queries when the DDG HTML endpoint is challenge-blocked (Vercel IPs).
async function searchGoogleNewsRss(query: string, limit: number, signal: AbortSignal): Promise<WebSearchResult[]> {
    try {
        const res = await fetch(
            `https://news.google.com/rss/search?q=${encodeURIComponent(query.trim())}&hl=ar&gl=EG&ceid=EG:ar`,
            { headers: { "User-Agent": "stokscan-ai/1.0" }, signal }
        );
        if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
        const xml = await res.text();
        const items = xml.split("<item>").slice(1);
        const results: WebSearchResult[] = [];
        for (const item of items) {
            if (results.length >= limit) break;
            const title = decodeHtml((item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "");
            const link = ((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
            const source = decodeHtml((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "");
            const published = Date.parse((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
            if (!title || !link.startsWith("http")) continue;
            results.push({
                title,
                snippet: source ? `خبر منشور في: ${source}` : "",
                url: link,
                domain: source || extractDomain(link),
                published_at: Number.isFinite(published) ? new Date(published).toISOString() : null,
            });
        }
        return results;
    } catch (e: any) {
        console.warn(`[WebSearch] Google News RSS failed for "${query}": ${e?.message || e}`);
        throw e;
    }
}

// DuckDuckGo Instant Answer JSON API — a real API surface that accepts
// datacenter traffic when the HTML endpoint is challenge-blocked.
async function searchDdgInstant(query: string, limit: number, signal: AbortSignal): Promise<WebSearchResult[]> {
    try {
        const res = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query.trim())}&format=json&no_html=1&no_redirect=1&kl=eg-ar`,
            { headers: { "User-Agent": "stokscan-ai/1.0" }, signal }
        );
        if (!res.ok) throw new Error(`DDG Instant HTTP ${res.status}`);
        const data: any = await res.json();
        const results: WebSearchResult[] = [];
        if (data?.AbstractText && data?.AbstractURL) {
            results.push({
                title: decodeHtml(data.Heading || query),
                snippet: decodeHtml(data.AbstractText),
                url: data.AbstractURL,
                domain: extractDomain(data.AbstractURL)
            });
        }
        const walk = (topics: any[]) => {
            for (const topic of topics || []) {
                if (results.length >= limit) return;
                if (Array.isArray(topic?.Topics)) walk(topic.Topics);
                else if (topic?.Text && topic?.FirstURL) {
                    results.push({
                        title: decodeHtml(topic.Text).slice(0, 90),
                        snippet: decodeHtml(topic.Text),
                        url: topic.FirstURL,
                        domain: extractDomain(topic.FirstURL)
                    });
                }
            }
        };
        walk(data?.RelatedTopics);
        return results.slice(0, limit);
    } catch (e: any) {
        console.warn(`[WebSearch] DDG Instant Answer failed for "${query}": ${e?.message || e}`);
        throw e;
    }
}

// Wikipedia search (Arabic first, then English) — last-resort keyless source
// that reliably serves datacenter IPs.
async function searchWikipedia(query: string, limit: number, signal: AbortSignal, lang: string): Promise<WebSearchResult[]> {
        try {
            const res = await fetch(
                `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.trim())}&srlimit=${limit}&format=json&origin=*`,
                { signal }
            );
            if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
            const data: any = await res.json();
            const hits: any[] = data?.query?.search || [];
            if (hits.length > 0) {
                return hits.map(hit => ({
                    title: decodeHtml(hit.title || ""),
                    snippet: decodeHtml(hit.snippet || ""),
                    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(hit.title || "").replace(/ /g, "_"))}`,
                    domain: `${lang}.wikipedia.org`
                }));
            }
        } catch (e: any) {
            console.warn(`[WebSearch] Wikipedia (${lang}) failed for "${query}": ${e?.message || e}`);
            throw e;
        }
    return [];
}
