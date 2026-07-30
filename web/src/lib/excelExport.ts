/**
 * Utility to parse Markdown tables and export them into Excel/CSV downloadable files
 */

export function parseMarkdownTable(markdownText: string): { headers: string[]; rows: string[][] } | null {
    const lines = markdownText.split("\n").map(l => l.trim()).filter(Boolean);
    const tableLines = lines.filter(l => l.startsWith("|") && l.endsWith("|"));

    if (tableLines.length < 2) return null;

    // Filter out separator lines like |---|---|
    const contentLines = tableLines.filter(line => !/^\|[\s:\-|\+]+\|$/.test(line));

    if (contentLines.length < 2) return null;

    const headers = contentLines[0]
        .split("|")
        .slice(1, -1)
        .map(cell => cell.trim());

    const rows = contentLines.slice(1).map(line =>
        line
            .split("|")
            .slice(1, -1)
            .map(cell => cell.trim())
    );

    if (headers.length === 0 || rows.length === 0) return null;

    return { headers, rows };
}

export function exportTableToExcel(headers: string[], rows: string[][], filename: string = "EGX_Bots_Analysis") {
    if (!headers.length || !rows.length) return;

    // BOM header for Excel UTF-8 Arabic encoding compatibility
    const BOM = "\uFEFF";
    
    const escapeCell = (value: string) => {
        const text = String(value ?? "");
        const trimmed = text.trimStart();
        const formulaLike = /^[=@+]/.test(trimmed) || (/^-/.test(trimmed) && !/^-\d/.test(trimmed));
        const safeText = formulaLike ? `'${text}` : text;
        return `"${safeText.replace(/"/g, '""')}"`;
    };

    let csvContent = BOM;
    csvContent += headers.map(escapeCell).join(",") + "\n";

    rows.forEach(row => {
        csvContent += row.map(escapeCell).join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 500);
}
