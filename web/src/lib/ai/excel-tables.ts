import { ToolResult, VisionContext } from "./types";

export interface ExcelTable {
    id: string;
    title: string;
    headers: string[];
    rows: string[][];
    source: string;
    data_time: string;
}

const cell = (value: unknown): string => {
    if (value === null || value === undefined || value === "N/A") return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
};

function stockRow(stock: any, symbolFallback = ""): string[] {
    const tech = stock?.tech || stock;
    const price = stock?.price?.close ?? stock?.price ?? tech?.close ?? "";
    const change = tech?.change_pct ?? stock?.change_pct ?? stock?.change ?? "";
    const volume = tech?.vol_ratio ?? stock?.vol_ratio ?? (
        tech?.volume != null && tech?.vol_sma20
            ? Number(tech.volume) / Number(tech.vol_sma20)
            : ""
    );

    return [
        cell(stock?.symbol || symbolFallback),
        cell(stock?.name || stock?.info?.name),
        cell(price),
        cell(change),
        cell(volume),
        cell(tech?.rsi_14 ?? stock?.rsi_14),
        cell(tech?.macd_signal ?? stock?.macd_signal),
        cell(stock?.signal || tech?.signal || "")
    ];
}

const stockHeaders = ["السهم", "الاسم", "السعر", "التغير %", "نسبة الحجم", "RSI", "MACD", "الإشارة"];

function buildStockTable(tool: ToolResult): ExcelTable | null {
    const data = tool.data || {};
    const stocks = Array.isArray(data.stocks) ? data.stocks : [data];
    const rows = stocks
        .filter((stock: any) => stock?.symbol)
        .map((stock: any) => stockRow(stock));
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "بيانات الأسهم",
        headers: stockHeaders,
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildSectorTable(tool: ToolResult): ExcelTable | null {
    const data = tool.data || {};
    const stocks = Array.isArray(data.stocks) ? data.stocks : [];
    const rows = stocks.filter((stock: any) => stock?.symbol).map((stock: any) => stockRow(stock));
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: `تحليل قطاع ${cell(data.sector)}`,
        headers: stockHeaders,
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildComparisonTable(tool: ToolResult): ExcelTable | null {
    const data = tool.data || {};
    const entries = [data.sym1, data.sym2].filter(Boolean);
    const rows = entries.map((entry: any, index: number) => stockRow(entry, entry?.info?.symbol || tool.symbols[index]));
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "مقارنة الأسهم",
        headers: stockHeaders,
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildRecommendationsTable(tool: ToolResult): ExcelTable | null {
    const recommendations = Array.isArray(tool.data) ? tool.data : [];
    const rows = recommendations.map((item: any) => [
        cell(item.symbol), cell(item.name), cell(item.signal), cell(item.entry_price),
        cell(item.target_price), cell(item.stop_loss), cell(item.created_at)
    ]);
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "الإشارات المسجلة",
        headers: ["السهم", "الاسم", "الإشارة", "سعر الدخول", "الهدف", "وقف الخسارة", "التاريخ"],
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildAccumulationTable(tool: ToolResult): ExcelTable | null {
    const stocks = Array.isArray(tool.data?.stocks) ? tool.data.stocks : [];
    const rows = stocks.filter((stock: any) => stock?.symbol).map((stock: any) => [
        cell(stock.symbol),
        cell(stock.name),
        cell(stock.acc_score),
        cell(stock.dist_score),
        cell(stock.vol_ratio),
        cell(stock.change_pct),
        cell(stock.rsi_14),
        cell(stock.macd_signal),
        cell(stock.wyckoff_phase),
        cell(stock.consecutive_acc_days)
    ]);
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "التجميع والسيولة المؤسسية",
        headers: ["السهم", "الاسم", "درجة التجميع", "درجة التصريف", "نسبة الحجم", "التغير %", "RSI", "MACD", "مرحلة Wyckoff", "أيام التجميع"],
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildNewsTable(tool: ToolResult): ExcelTable | null {
    const news = Array.isArray(tool.data) ? tool.data : [];
    const rows = news.map((item: any) => [
        cell(item.symbol), cell(item.date || item.published_at), cell(item.sentiment_label),
        cell(item.sentiment_score), cell(item.news_count), cell(item.title || item.headline)
    ]).filter((row: string[]) => row.some(Boolean));
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "أخبار ومعنويات الأسهم",
        headers: ["السهم", "التاريخ", "المعنويات", "درجة المعنويات", "عدد الأخبار", "العنوان"],
        rows,
        source: tool.source,
        data_time: tool.data_time,
    };
}

function buildHistoricalFactsTable(tool: ToolResult): ExcelTable | null {
    const facts = tool.data && typeof tool.data === "object" ? tool.data : {};
    const rows = Object.entries(facts).map(([key, value]) => [key, cell(value)]);
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "البيانات التاريخية المسترجعة",
        headers: ["الحقل", "القيمة"],
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

function buildMarketTable(tool: ToolResult): ExcelTable | null {
    const data = tool.data || {};
    const rows = [
        ["EGX30", cell(data.egx30), ""],
        ["EGX100", cell(data.egx100), ""],
        ["USD/EGP", cell(data.usd), ""],
        ["اتجاه السوق", cell(data.regime), ""]
    ].filter(row => row[1]);
    if (rows.length === 0) return null;

    return {
        id: tool.tool,
        title: "ملخص السوق",
        headers: ["المؤشر", "القيمة", "التغير"],
        rows,
        source: tool.source,
        data_time: tool.data_time
    };
}

export function buildExcelTables(toolResults: ToolResult[], vision: VisionContext | null): ExcelTable[] {
    const tables: ExcelTable[] = [];

    if (vision?.symbols.length) {
        const observations = new Map(
            vision.technical_observations.map(observation => [`${observation.symbol}:${observation.indicator}`, observation.value])
        );
        const rows = vision.symbols.map(symbol => [
            cell(symbol.symbol),
            cell(symbol.name),
            cell(symbol.visible_values.price),
            cell(symbol.visible_values.change_pct),
            cell(symbol.visible_values.quantity),
            cell(observations.get(`${symbol.symbol}:RSI`)),
            cell(observations.get(`${symbol.symbol}:MACD`))
        ]);
        tables.push({
            id: "vision",
            title: "البيانات المستخرجة من الصورة",
            headers: ["السهم", "الاسم", "السعر الظاهر", "التغير الظاهر %", "الكمية الظاهرة", "RSI", "MACD"],
            rows,
            source: "vision_analysis",
            data_time: vision.analyzed_at
        });
    }

    const stockTools = toolResults.filter(tool => tool.tool === "get_stock");
    if (stockTools.length > 0) {
        const first = stockTools[0];
        const rows = stockTools.map(tool => stockRow(tool.data, tool.symbols[0]));
        tables.push({
            id: "get_stock",
            title: "بيانات الأسهم",
            headers: stockHeaders,
            rows,
            source: first.source,
            data_time: first.data_time
        });
    }

    for (const tool of toolResults) {
        if (tool.tool === "get_stock") continue;
        let table: ExcelTable | null = null;
        if (tool.tool === "get_sector") table = buildSectorTable(tool);
        else if (tool.tool === "get_comparison") table = buildComparisonTable(tool);
        else if (tool.tool === "get_recommendations") table = buildRecommendationsTable(tool);
        else if (tool.tool === "get_accumulation_stocks") table = buildAccumulationTable(tool);
        else if (tool.tool === "get_news") table = buildNewsTable(tool);
        else if (tool.tool === "get_historical_facts") table = buildHistoricalFactsTable(tool);
        else if (tool.tool === "get_market") table = buildMarketTable(tool);
        else if (tool.tool === "get_stock") table = buildStockTable(tool);

        if (table) tables.push(table);
    }

    return tables;
}

export function tablesToMarkdown(tables: ExcelTable[]): string {
    return tables.map(table => {
        const header = `### ${table.title} (${table.data_time})`;
        const separator = `| ${table.headers.map(() => "---").join(" | ")} |`;
        const headings = `| ${table.headers.join(" | ")} |`;
        const rows = table.rows.map(row => `| ${row.map(value => value.replace(/\|/g, "\\|")).join(" | ")} |`);
        return [header, headings, separator, ...rows].join("\n");
    }).join("\n\n");
}
