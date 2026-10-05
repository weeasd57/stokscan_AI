/** Ownership is structural: in an ALCN section, "أقل من GBCO" compares
 * against GBCO; it does not assign ALCN's observation to GBCO. */
export function stockSection(line: string, symbols: string[]): string | null {
    const plain = line.replace(/[*#_`]/g, "").trim();
    return symbols.find(symbol => new RegExp(`^(?:سهم\\s+)?${symbol}\\s*[:：]?$`, "i").test(plain)) || null;
}

export function proseOwner(clause: string, symbols: string[], section: string | null): string | null {
    const named = symbols.map(symbol => ({ symbol, index: clause.search(new RegExp(`\\b${symbol}\\b`, "i")) }))
        .filter(item => item.index >= 0).sort((a, b) => a.index - b.index);
    if (!named.length) return section;
    const first = named[0];
    const prefix = clause.slice(0, first.index).replace(/[*_`]/g, "");
    if (/(?:من|عن|مقابل|than|vs)\s*$/i.test(prefix)) return section;
    return first.symbol;
}
