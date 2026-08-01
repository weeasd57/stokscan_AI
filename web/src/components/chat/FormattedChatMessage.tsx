"use client";

import React, { useEffect, useRef, useState } from "react";
import { parseMarkdownTable, exportTableToExcel } from "@/lib/excelExport";
import { FileSpreadsheet, Download, Check, Sparkles, Copy } from "lucide-react";
import StockCard, { StockData } from "./StockCard";
import type { ChatTable } from "@/contexts/ChatContext";
import { sanitizeUiLabel } from "@/lib/ai/sanitizer";

interface FormattedChatMessageProps {
    content: string;
    role: "user" | "assistant" | "system";
    suggestedButtons?: string[];
    onButtonClick?: (text: string) => void;
    showSuggestedButtons?: boolean;
    isStreaming?: boolean;
    tables?: ChatTable[];
}

interface RawPipeStock {
    symbol: string;
    score: string;
    val1: string;
    val2: string;
    val3: string;
    val4: string;
    val5: string;
    signal: string;
    days: string;
}

type ContentBlock = 
    | { type: "text"; content: string }
    | { type: "table"; headers: string[]; rows: string[][] }
    | { type: "stock_card"; stock: StockData; rawJson: string }
    | { type: "raw_pipe_table"; items: RawPipeStock[] };

const KNOWN_STOCK_SYMBOLS = new Set([
    "COMI", "EAST", "HRHO", "SWDY", "FWRY", "TMGH", "AMOC", "EKHO", "ABUK", "MFPC",
    "ORAS", "CICH", "ETEL", "JUFO", "DOMT", "SKPC", "ISPH", "ORWE", "GBAUTO", "GBCO",
    "HELI", "PHDC", "EGX30", "EGX70", "EGX100", "USDEGP", "AALR", "ACAMD", "ACAP",
    "ADCI", "ADPC", "AFMC", "AIH", "AJWA", "ALUM", "APPC", "ARAB", "AREH", "ARVA",
    "ATQA", "AXPH", "BIOC", "BTFH", "CIEB", "CNFN", "COPR", "CPCI", "CRST", "EEII",
    "EFID", "EFIH", "EGAL", "EGBE", "EGCH", "EGREF", "EGSA", "EGTS", "EHDR", "EITP",
    "ELKA", "ELSH", "EOSB", "ETRS", "FAIT", "FERC", "GDWA", "GGCC", "GGRN", "GMCI",
    "GOUR", "GSSC", "ICFC", "IDRE", "INFI", "IRON", "ISMA", "KABO", "KASABF", "KRDI",
    "KZPC", "LUTS", "MASR", "MBSC", "MCQE", "MENA", "MFSC", "MICH", "MILS", "MOIL",
    "MOSC", "MPCO", "MTIE", "NEDA", "NHPS", "NINH", "PHTV", "POUL", "PRDC", "RACC",
    "RTVC", "RUBX", "SAUD", "SCEM", "SCTS", "SEIG", "SIPC", "SNFC", "SPIN", "TANM",
    "TRTO", "TWSA", "UEFM", "UNIT", "VALU", "VLMRA", "WATP"
]);

function parseStockJson(text: string): StockData[] | null {
    try {
        const trimmed = text.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
        
        const parsed = JSON.parse(trimmed);
        
        const isStockObj = (obj: any): obj is StockData => {
            if (!obj || typeof obj !== "object") return false;
            const symbol = obj.symbol || obj.ticker;
            if (!symbol || typeof symbol !== "string") return false;
            
            if (obj.type && ["stock", "stock_card", "stock_data", "stock_payload"].includes(obj.type)) {
                return true;
            }
            
            const hasPrice = obj.price !== undefined;
            const hasRsi = obj.rsi !== undefined;
            const hasMacd = obj.macdSignal !== undefined || obj.macd_signal !== undefined || obj.macd !== undefined;
            const hasChange = obj.changePercent !== undefined || obj.change_percent !== undefined || obj.change !== undefined;
            
            return hasPrice || hasRsi || hasMacd || hasChange;
        };

        if (Array.isArray(parsed)) {
            const validStocks = parsed.filter(isStockObj);
            return validStocks.length > 0 ? validStocks : null;
        } else if (isStockObj(parsed)) {
            return [parsed];
        } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.stocks)) {
            const validStocks = parsed.stocks.filter(isStockObj);
            return validStocks.length > 0 ? validStocks : null;
        }

        return null;
    } catch {
        return null;
    }
}

function parseRawPipeLine(line: string): RawPipeStock[] | null {
    if (!line.includes("|")) return null;
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) return null;
    if (!/(strong_?accumulation|strong_?distribution|accumulation|distribution)/i.test(line)) return null;
    const pipes = line.split("|").map(s => s.trim());
    if (pipes.length < 8) return null;

    const items: RawPipeStock[] = [];
    let i = 0;
    
    let currentHeader = pipes[0];
    
    try {
        while (i + 7 < pipes.length) {
            const val1 = pipes[i + 1];
            const val2 = pipes[i + 2];
            const val3 = pipes[i + 3];
            const val4 = pipes[i + 4];
            const val5 = pipes[i + 5];
            const signal = pipes[i + 6];
            const nextPart = pipes[i + 7];
            
            const headerMatch = currentHeader.match(/([A-Z0-9]{2,6})\s+([\d.]+)/i) || currentHeader.match(/([A-Z0-9]{2,6})/i);
            const symbol = headerMatch ? headerMatch[1].toUpperCase() : "STOCK";
            const score = headerMatch && headerMatch[2] ? headerMatch[2] : "N/A";
            const validSignal = /(strong\s+accumulation|strong\s+distribution|accumulation|distribution)/i.test(signal.replace(/_/g, " "));
            if (!/^[A-Z0-9]{2,10}$/.test(symbol) || !validSignal || !Number.isFinite(Number(val2)) || !Number.isFinite(Number(val4))) {
                return null;
            }
            
            const nextMatch = nextPart.match(/^([\d.]+)\s+(.*)$/);
            let days = nextPart;
            let nextHeader = "";
            if (nextMatch) {
                days = nextMatch[1];
                nextHeader = nextMatch[2].trim();
            }
            
            items.push({
                symbol,
                score,
                val1,
                val2,
                val3,
                val4,
                val5,
                signal: signal.replace(/_/g, " "),
                days
            });
            
            currentHeader = nextHeader;
            i += 7;
        }
    } catch (e) {
        console.warn("Failed to parse raw pipe line:", e);
    }
    
    return items.length > 0 ? items : null;
}

function parseContentBlocks(content: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    const lines = content.split("\n");
    let currentTextLines: string[] = [];
    let currentTableLines: string[] = [];
    let currentCodeBlockLines: string[] = [];
    let inTable = false;
    let inCodeBlock = false;
    let codeBlockLang = "";

    const flushText = () => {
        if (currentTextLines.length > 0) {
            blocks.push({ type: "text", content: currentTextLines.join("\n") });
            currentTextLines = [];
        }
    };

    const flushTable = () => {
        if (currentTableLines.length > 0) {
            const tableLines = currentTableLines.map(l => l.trim()).filter(Boolean);
            const contentLines = tableLines.filter(line => !/^\|[\s:\-|\+]+\|$/.test(line));
            
            if (contentLines.length >= 2) {
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
                if (headers.length > 0 && rows.length > 0) {
                    blocks.push({ type: "table", headers, rows });
                } else {
                    currentTextLines.push(...currentTableLines);
                }
            } else {
                currentTextLines.push(...currentTableLines);
            }
            currentTableLines = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Code block start/end
        if (trimmed.startsWith("```")) {
            if (inCodeBlock) {
                inCodeBlock = false;
                const codeContent = currentCodeBlockLines.join("\n");
                const stocks = parseStockJson(codeContent);
                if (stocks && stocks.length > 0) {
                    flushText();
                    stocks.forEach(stock => {
                        blocks.push({ type: "stock_card", stock, rawJson: codeContent });
                    });
                } else {
                    currentTextLines.push("```" + codeBlockLang);
                    currentTextLines.push(...currentCodeBlockLines);
                    currentTextLines.push("```");
                }
                currentCodeBlockLines = [];
                codeBlockLang = "";
                continue;
            } else {
                if (inTable) {
                    flushTable();
                    inTable = false;
                }
                flushText();
                inCodeBlock = true;
                codeBlockLang = trimmed.substring(3).trim();
                currentCodeBlockLines = [];
                continue;
            }
        }

        if (inCodeBlock) {
            currentCodeBlockLines.push(line);
            continue;
        }

        const isTableLine = trimmed.startsWith("|") && trimmed.endsWith("|");

        if (isTableLine) {
            if (!inTable) {
                flushText();
                inTable = true;
            }
            currentTableLines.push(line);
        } else {
            if (inTable) {
                flushTable();
                inTable = false;
            }
            const rawPipeItems = parseRawPipeLine(line);
            if (rawPipeItems) {
                flushText();
                blocks.push({ type: "raw_pipe_table", items: rawPipeItems });
            } else {
                currentTextLines.push(line);
            }
        }
    }

    if (inCodeBlock) {
        const codeContent = currentCodeBlockLines.join("\n");
        const stocks = parseStockJson(codeContent);
        if (stocks && stocks.length > 0) {
            flushText();
            stocks.forEach(stock => {
                blocks.push({ type: "stock_card", stock, rawJson: codeContent });
            });
        } else {
            currentTextLines.push("```" + codeBlockLang);
            currentTextLines.push(...currentCodeBlockLines);
        }
    } else if (inTable) {
        flushTable();
    }

    flushText();

    // Inline JSON scan in text blocks
    const finalBlocks: ContentBlock[] = [];
    for (const b of blocks) {
        if (b.type === "text") {
            const jsonRegex = /\{[\s\S]*?\}/g;
            let lastIndex = 0;
            let match: RegExpExecArray | null;
            let textAdded = false;

            while ((match = jsonRegex.exec(b.content)) !== null) {
                const jsonCandidate = match[0];
                const stocks = parseStockJson(jsonCandidate);
                if (stocks && stocks.length > 0) {
                    const prefix = b.content.substring(lastIndex, match.index).trim();
                    if (prefix) {
                        finalBlocks.push({ type: "text", content: prefix });
                    }
                    stocks.forEach(stock => {
                        finalBlocks.push({ type: "stock_card", stock, rawJson: jsonCandidate });
                    });
                    lastIndex = match.index + jsonCandidate.length;
                    textAdded = true;
                }
            }

            if (textAdded) {
                const suffix = b.content.substring(lastIndex).trim();
                if (suffix) {
                    finalBlocks.push({ type: "text", content: suffix });
                }
            } else {
                finalBlocks.push(b);
            }
        } else {
            finalBlocks.push(b);
        }
    }

    return finalBlocks;
}

function ExportableTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="my-4 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/90 shadow-md max-w-full">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 min-w-0">
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    جدول تحليلي جاهز للتصدير
                </span>
                <button
                    onClick={() => {
                        exportTableToExcel(headers, rows);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all shadow-md active:scale-95"
                >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                    {copied ? "تم التحميل!" : "تصدير لإكسيل (Excel)"}
                </button>
            </div>

            <div className="w-full max-w-full overflow-x-auto my-2 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm scrollbar-thin">
                <table className="w-full text-[11px] sm:text-xs text-right border-collapse">
                    <thead>
                        <tr className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-700">
                            {headers.map((h, i) => (
                                <th key={i} className="px-2 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs whitespace-nowrap font-bold border-l border-zinc-200 dark:border-zinc-700/50 last:border-l-0">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rIdx) => (
                            <tr key={rIdx} className="border-b border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="px-2 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs whitespace-nowrap border-l border-zinc-200 dark:border-zinc-800/50 last:border-l-0 text-zinc-800 dark:text-zinc-300 font-mono">
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function FormattedChatMessage({
    content,
    role,
    suggestedButtons,
    onButtonClick,
    showSuggestedButtons = true,
    isStreaming = false,
    tables = []
}: FormattedChatMessageProps) {
    content = sanitizeUiLabel(content);
    suggestedButtons = suggestedButtons?.map(sanitizeUiLabel).filter(Boolean);
    if (/environment_details|Current time:|Working directory:|Workspace root folder:/i.test(content)) content = "";
    const [copiedText, setCopiedText] = useState(false);
    const mermaidContainerRef = useRef<HTMLDivElement>(null);

    const mermaidMatch = !isStreaming ? content.match(/```mermaid\s+([\s\S]*?)```/g) : null;
    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    useEffect(() => {
        if (!isStreaming && mermaidCode && mermaidContainerRef.current) {
            const isDark = document.documentElement.classList.contains("dark");
            import("mermaid").then((mermaid) => {
                mermaid.default.initialize({
                    startOnLoad: false,
                    theme: isDark ? "dark" : "default",
                    securityLevel: "loose",
                });
                const id = "mermaid-" + Math.random().toString(36).substring(2, 9);
                mermaid.default.render(id, mermaidCode).then(({ svg }) => {
                    if (mermaidContainerRef.current) {
                        mermaidContainerRef.current.innerHTML = svg;
                    }
                }).catch((err) => {
                    console.error("Mermaid Render Error:", err);
                });
            });
        }
    }, [mermaidCode, isStreaming]);

    if (role === "user") {
        return (
            <div className="space-y-1 text-right" dir="rtl">
                <div className="dir-auto whitespace-pre-wrap text-zinc-900 dark:text-zinc-100 break-words overflow-wrap-anywhere text-xs sm:text-sm leading-relaxed">{content}</div>
                <div className="flex justify-start pt-0.5">
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard.writeText(content);
                            setCopiedText(true);
                            setTimeout(() => setCopiedText(false), 2000);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="نسخ رسالتك"
                    >
                        {copiedText ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span className="font-sans">{copiedText ? "Copied!" : "Copy"}</span>
                    </button>
                </div>
            </div>
        );
    }

    const blocks: ContentBlock[] = parseContentBlocks(content).filter(block => {
        if (block.type !== "table") return true;
        return !tables.some(table => JSON.stringify(table.headers) === JSON.stringify(block.headers));
    });
    const renderFormattedText = (text: string, isLastBlock: boolean) => {
        let cleanText = text.replace(/```mermaid\s+[\s\S]*?```/g, "").trim();
        const lines = cleanText.split("\n");

        return lines.map((line, idx) => {
            const isLastLine = isLastBlock && idx === lines.length - 1;
            const isTableLine = line.trim().startsWith("|") && line.trim().endsWith("|");

            if (!line.trim() && !isLastLine) {
                return <div key={idx} className="h-2" />;
            }

            const trimmedLine = line.trim();

            // Headings
            let isHeading = false;
            let headingLevel = 0;
            let headingContent = line;

            if (trimmedLine.startsWith("### ")) {
                isHeading = true;
                headingLevel = 3;
                headingContent = trimmedLine.substring(4);
            } else if (trimmedLine.startsWith("## ")) {
                isHeading = true;
                headingLevel = 2;
                headingContent = trimmedLine.substring(3);
            } else if (trimmedLine.startsWith("# ")) {
                isHeading = true;
                headingLevel = 1;
                headingContent = trimmedLine.substring(2);
            }

            if (isHeading) {
                const headingClass = headingLevel === 1 
                    ? "text-base sm:text-lg font-extrabold text-zinc-950 dark:text-zinc-50 my-3 border-b border-zinc-200 dark:border-zinc-800 pb-1"
                    : headingLevel === 2
                    ? "text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 my-2"
                    : "text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400 my-2";
                
                const HeadingTag = `h${headingLevel}` as keyof JSX.IntrinsicElements;
                
                return (
                    <HeadingTag key={idx} className={headingClass} dir="rtl">
                        {headingContent.split(/(\*\*.*?\*\*)/g).map((boldPart, bpIdx) => {
                            const isBold = boldPart.startsWith("**") && boldPart.endsWith("**");
                            const cleanBold = isBold ? boldPart.substring(2, boldPart.length - 2) : boldPart;
                            if (isBold) {
                                return <strong key={bpIdx} className="font-extrabold">{cleanBold}</strong>;
                            }
                            return cleanBold;
                        })}
                    </HeadingTag>
                );
            }

            // Bullet check
            const isBullet = trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("• ") || trimmedLine.startsWith("•");
            let lineContent = line;
            if (isBullet) {
                if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("• ")) {
                    lineContent = trimmedLine.substring(2);
                } else if (trimmedLine.startsWith("•")) {
                    lineContent = trimmedLine.substring(1);
                }
            }

            const parseTextSpans = (textStr: string) => {
                const boldParts = textStr.split(/(\*\*.*?\*\*)/g);
                return boldParts.map((part, bIdx) => {
                    const isBold = part.startsWith("**") && part.endsWith("**");
                    const cleanPart = isBold ? part.substring(2, part.length - 2) : part;

                    const subParts = cleanPart.split(/(\d+(?:[,.]\d+)*|\b[A-Z0-9_]{2,10}\b|\$\d+(?:[,.]\d+)*)/g);
                    const renderedSubParts = subParts.map((sub, sIdx) => {
                        const upper = sub.toUpperCase();
                        const isStockSymbol = KNOWN_STOCK_SYMBOLS.has(upper) || /^EGX:\w+/i.test(sub);
                        const isNumericCurrency = /^(\d+(?:[,.]\d+)*|\$\d+(?:[,.]\d+)*|EGP)$/.test(sub);

                        if (isStockSymbol) {
                            return (
                                <span 
                                    key={sIdx} 
                                    dir="ltr" 
                                    className="inline-block px-1.5 py-0.5 font-mono font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-zinc-800/80 border border-amber-500/20 dark:border-zinc-700 rounded text-[11px] sm:text-xs mx-0.5"
                                    style={{ unicodeBidi: "isolate" }}
                                >
                                    {sub}
                                </span>
                            );
                        } else if (isNumericCurrency) {
                            return (
                                <span 
                                    key={sIdx} 
                                    dir="ltr" 
                                    className="inline-block px-1 py-0.5 font-mono font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-zinc-800/80 rounded text-[11px] sm:text-xs mx-0.5"
                                    style={{ unicodeBidi: "isolate" }}
                                >
                                    {sub}
                                </span>
                            );
                        }
                        return sub;
                    });

                    if (isBold) {
                        return <strong key={bIdx} className="font-extrabold text-zinc-950 dark:text-white">{renderedSubParts}</strong>;
                    }
                    return <React.Fragment key={bIdx}>{renderedSubParts}</React.Fragment>;
                });
            };

            return (
                <div 
                    key={idx} 
                    className={`leading-relaxed text-xs sm:text-sm break-words overflow-wrap-anywhere my-1 dir-auto text-zinc-900 dark:text-zinc-100 ${isBullet ? 'flex items-start gap-2 pr-2' : ''} ${isTableLine ? 'font-mono text-[11px] bg-zinc-100/80 dark:bg-zinc-900/80 p-1 rounded overflow-x-auto' : ''}`}
                >
                    {isBullet && <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-1">•</span>}
                    <span className="flex-1">
                        {parseTextSpans(lineContent)}

                        {isStreaming && isLastLine && (
                            <span 
                                className="inline-block w-2 text-amber-500 font-bold animate-pulse mr-1 select-none" 
                                title="جاري الكتابة..."
                                aria-hidden="true"
                            >
                                ▌
                            </span>
                        )}
                    </span>
                </div>
            );
        });
    };

    const actionButtons = (suggestedButtons && suggestedButtons.length > 0)
        ? suggestedButtons
        : ["قارن بـ COMI", "هل في تجميع مؤسسي؟", "شبه ده حصل امتى؟", "قد إيه بعيد عن الحد؟"];

    return (
        <div className="space-y-3 w-full max-w-full min-w-0 text-right overflow-hidden" dir="rtl">
            {tables.map((table) => (
                <div key={`${table.id}-${table.data_time || ""}`} className="space-y-1">
                    <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                        {table.title}{table.data_time ? ` (${String(table.data_time).slice(0, 10)})` : ""}
                    </div>
                    <ExportableTable headers={table.headers} rows={table.rows} />
                </div>
            ))}
            {blocks.map((block, bIdx) => {
                const isLastBlock = bIdx === blocks.length - 1;
                if (block.type === "text") {
                    return (
                        <div key={bIdx} className="space-y-1 break-words overflow-wrap-anywhere text-xs sm:text-sm leading-relaxed">
                            {renderFormattedText(block.content, isLastBlock)}
                        </div>
                    );
                } else if (block.type === "table") {
                    return (
                        <div key={bIdx} className="space-y-1">
                            <ExportableTable headers={block.headers} rows={block.rows} />
                            {isStreaming && isLastBlock && (
                                <span className="inline-block w-2 text-amber-500 font-bold animate-pulse mr-1 select-none">▌</span>
                            )}
                        </div>
                    );
                } else if (block.type === "raw_pipe_table") {
                    const headers = ["السهم", "درجة التجميع", "نسبة السيولة", "RSI", "الحالة", "أيام التوالي"];
                    const rows = block.items.map(item => {
                        let signalText = item.signal;
                        if (item.signal.includes("strong accumulation") || item.signal.includes("strong_accumulation")) {
                            signalText = "تجميع قوي 📈";
                        } else if (item.signal.includes("accumulation")) {
                            signalText = "تجميع 📈";
                        } else if (item.signal.includes("strong distribution") || item.signal.includes("strong_distribution")) {
                            signalText = "تصريف قوي 📉";
                        } else if (item.signal.includes("distribution")) {
                            signalText = "تصريف 📉";
                        }
                        
                        return [
                            item.symbol,
                            `${item.score}/100`,
                            `${Number(item.val2).toFixed(2)}x`,
                            Number(item.val4).toFixed(1),
                            signalText,
                            `${item.days} أيام`
                        ];
                    });
                    
                    return (
                        <div key={bIdx} className="space-y-1">
                            <ExportableTable headers={headers} rows={rows} />
                            {isStreaming && isLastBlock && (
                                <span className="inline-block w-2 text-amber-500 font-bold animate-pulse mr-1 select-none">▌</span>
                            )}
                        </div>
                    );
                } else if (block.type === "stock_card") {
                    return (
                        <StockCard 
                            key={bIdx} 
                            stock={block.stock} 
                            onSymbolClick={(symbol) => {
                                if (onButtonClick) {
                                    onButtonClick(`تحليل ${symbol}`);
                                }
                            }}
                        />
                    );
                }
                return null;
            })}

            {mermaidCode && (
                <div className="my-4 p-4 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto shadow-sm max-w-full">
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                        📊 رسم بياني تفاعلي (Diagram)
                    </div>
                    <div ref={mermaidContainerRef} className="flex justify-center items-center min-h-[120px]" />
                </div>
            )}

            {role === "assistant" && !isStreaming && (
                <div className="pt-2 flex flex-wrap gap-1.5 justify-start items-center">
                    <button
                        type="button"
                        onClick={() => {
                            const tableText = tables.map(table => [
                                `${table.title}${table.data_time ? ` (${String(table.data_time).slice(0, 10)})` : ""}`,
                                table.headers.join("\t"),
                                ...table.rows.map(row => row.join("\t"))
                            ].join("\n")).join("\n\n");
                            navigator.clipboard.writeText([tableText, content].filter(Boolean).join("\n\n"));
                            setCopiedText(true);
                            setTimeout(() => setCopiedText(false), 2000);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="نسخ الرد"
                    >
                        {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="font-sans">{copiedText ? "Copied!" : "Copy"}</span>
                    </button>

                    {onButtonClick && showSuggestedButtons && actionButtons.map((btnText, bIdx) => (
                        <button
                            key={bIdx}
                            type="button"
                            onClick={() => onButtonClick(btnText)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
                        >
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            <span>{btnText}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
