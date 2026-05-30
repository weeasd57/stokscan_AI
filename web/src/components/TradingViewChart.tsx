"use client";

import { useEffect, useRef } from "react";

interface TradingViewChartProps {
    symbol: string;
    theme?: "dark" | "light";
}

declare global {
    interface Window {
        TradingView: any;
    }
}

export default function TradingViewChart({ symbol, theme = "dark" }: TradingViewChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const containerId = `tv-widget-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Clean up previous widget content
        container.innerHTML = "";

        const scriptId = "tradingview-widget-script";
        let script = document.getElementById(scriptId) as HTMLScriptElement;

        const initWidget = () => {
            if (typeof window !== "undefined" && window.TradingView) {
                let tvSymbol = symbol;
                if (!symbol.includes(":")) {
                    if (symbol.toUpperCase().endsWith("USD") || symbol.toUpperCase().endsWith("USDT") || symbol.includes("/")) {
                        tvSymbol = `BINANCE:${symbol.replace("/", "").toUpperCase()}`;
                    } else {
                        // EGX Stock Mapping
                        const EGX_MAPPINGS: Record<string, string> = {
                            "TMGH": "3ATMGH", // Talaat Moustafa Group
                        };
                        const mapped = EGX_MAPPINGS[symbol.toUpperCase()] || symbol.toUpperCase();
                        tvSymbol = `EGX:${mapped}`;
                    }
                }

                new window.TradingView.widget({
                    width: "100%",
                    height: "100%",
                    symbol: tvSymbol,
                    interval: "D",
                    timezone: "Etc/UTC",
                    theme: theme,
                    style: "1",
                    locale: "en",
                    toolbar_bg: theme === "dark" ? "#131722" : "#f1f3f6",
                    enable_publishing: false,
                    hide_side_toolbar: false,
                    allow_symbol_change: true,
                    container_id: containerId,
                    show_popup_button: true,
                    withdateranges: true,
                    studies: [
                        "RSI@tv-basicstudies",
                        "MASimple@tv-basicstudies"
                    ]
                });
            }
        };

        if (!script) {
            script = document.createElement("script");
            script.id = scriptId;
            script.src = "https://s3.tradingview.com/tv.js";
            script.type = "text/javascript";
            script.async = true;
            script.onload = initWidget;
            document.head.appendChild(script);
        } else {
            if (window.TradingView) {
                initWidget();
            } else {
                script.addEventListener("load", initWidget);
            }
        }

        return () => {
            if (script) {
                script.removeEventListener("load", initWidget);
            }
        };
    }, [symbol, theme, containerId]);

    return (
        <div className="w-full h-full relative">
            <div 
                id={containerId} 
                ref={containerRef} 
                className="w-full h-full"
            />
        </div>
    );
}
