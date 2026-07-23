"use client";

import React, { useEffect, useRef, useState } from "react";
import { parseMarkdownTable, exportTableToExcel } from "@/lib/excelExport";
import { FileSpreadsheet, Download, Check, Sparkles, Copy } from "lucide-react";

interface FormattedChatMessageProps {
    content: string;
    role: "user" | "assistant" | "system";
    suggestedButtons?: string[];
    onButtonClick?: (text: string) => void;
    showSuggestedButtons?: boolean;
}

type ContentBlock = 
    | { type: "text"; content: string }
    | { type: "table"; headers: string[]; rows: string[][] };

function parseContentBlocks(content: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    const lines = content.split("\n");
    let currentTextLines: string[] = [];
    let currentTableLines: string[] = [];
    let inTable = false;

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
            currentTextLines.push(line);
        }
    }

    if (inTable) {
        flushTable();
    } else {
        flushText();
    }

    return blocks;
}

function ExportableTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="my-4 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/90 shadow-md">
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
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

            <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm text-right border-collapse">
                    <thead>
                        <tr className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-700">
                            {headers.map((h, i) => (
                                <th key={i} className="px-3 py-2.5 font-bold border-l border-zinc-200 dark:border-zinc-700/50 last:border-l-0">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rIdx) => (
                            <tr key={rIdx} className="border-b border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="px-3 py-2 border-l border-zinc-200 dark:border-zinc-800/50 last:border-l-0 text-zinc-800 dark:text-zinc-300 font-mono">
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

export function FormattedChatMessage({ content, role, suggestedButtons, onButtonClick, showSuggestedButtons = true }: FormattedChatMessageProps) {
    const [copiedText, setCopiedText] = useState(false);
    const mermaidContainerRef = useRef<HTMLDivElement>(null);

    const mermaidMatch = content.match(/```mermaid\s+([\s\S]*?)```/g);
    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    useEffect(() => {
        if (mermaidCode && mermaidContainerRef.current) {
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
    }, [mermaidCode]);

    if (role === "user") {
        return (
            <div className="space-y-1 text-right" dir="rtl">
                <div className="dir-auto whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{content}</div>
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

    const blocks = parseContentBlocks(content);

    const renderFormattedText = (text: string) => {
        let cleanText = text.replace(/```mermaid\s+[\s\S]*?```/g, "").trim();
        const lines = cleanText.split("\n");

        return lines.map((line, idx) => {
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                return null;
            }

            if (!line.trim()) {
                return <div key={idx} className="h-2" />;
            }

            const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ");
            const lineContent = isBullet ? line.trim().substring(2) : line;

            return (
                <div 
                    key={idx} 
                    className={`leading-relaxed text-sm md:text-base my-1 dir-auto text-zinc-900 dark:text-zinc-100 ${isBullet ? 'flex items-start gap-2 pr-2' : ''}`}
                >
                    {isBullet && <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-1">•</span>}
                    <span className="flex-1">
                        {lineContent.split(/(\d+(?:[,.]\d+)*|\b[A-Z]{2,6}\b|EGP|\$\d+)/g).map((part, pIdx) => {
                            if (/^(\d+(?:[,.]\d+)*|\b[A-Z]{2,6}\b|EGP|\$\d+)$/.test(part)) {
                                return (
                                    <span 
                                        key={pIdx} 
                                        dir="ltr" 
                                        className="inline-block px-1.5 py-0.5 font-mono font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-zinc-800/80 border border-amber-500/20 dark:border-zinc-700 rounded text-xs md:text-sm"
                                        style={{ unicodeBidi: "isolate" }}
                                    >
                                        {part}
                                    </span>
                                );
                            }
                            return part;
                        })}
                    </span>
                </div>
            );
        });
    };

    const actionButtons = (suggestedButtons && suggestedButtons.length > 0)
        ? suggestedButtons
        : ["قارن بـ COMI", "هل في تجميع مؤسسي؟", "شبه ده حصل امتى؟", "قد إيه بعيد عن الحد؟"];

    return (
        <div className="space-y-3 w-full text-right" dir="rtl">
            {/* Render each block in order */}
            {blocks.map((block, bIdx) => {
                if (block.type === "text") {
                    return (
                        <div key={bIdx} className="space-y-1">
                            {renderFormattedText(block.content)}
                        </div>
                    );
                } else {
                    return (
                        <ExportableTable key={bIdx} headers={block.headers} rows={block.rows} />
                    );
                }
            })}

            {/* Mermaid Diagram Box */}
            {mermaidCode && (
                <div className="my-4 p-4 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto shadow-sm">
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                        📊 رسم بياني تفاعلي (Diagram)
                    </div>
                    <div ref={mermaidContainerRef} className="flex justify-center items-center min-h-[120px]" />
                </div>
            )}

            {/* Quick Action Interactive Buttons & Copy */}
            {role === "assistant" && (
                <div className="pt-2 flex flex-wrap gap-1.5 justify-start items-center">
                    {/* Copy Button */}
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard.writeText(content);
                            setCopiedText(true);
                            setTimeout(() => setCopiedText(false), 2000);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="نسخ الرد"
                    >
                        {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="font-sans">{copiedText ? "Copied!" : "Copy"}</span>
                    </button>

                    {/* Smart Buttons */}
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
