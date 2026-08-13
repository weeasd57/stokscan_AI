"use client";

import { useEffect, useState } from "react";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    ReferenceLine
} from "recharts";
import { Loader2, TrendingUp, BarChart3, PieChart as PieIcon, LineChart as LineIcon } from "lucide-react";

interface StatsData {
    summary: {
        positive: number;
        negative: number;
        neutral: number;
        total: number;
    };
    sectors: Array<{
        nameAr: string;
        nameEn: string;
        averageSentiment: number;
        newsCount: number;
        stocksCount: number;
    }>;
    timeline: Array<{
        date: string;
        averageSentiment: number;
        newsCount: number;
    }>;
}

interface NewsStatsProps {
    isAr: boolean;
    search: string;
    dateFilter: string;
}

export default function NewsStats({ isAr, search, dateFilter }: NewsStatsProps) {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDark, setIsDark] = useState(false);

    // Watch for theme / dark mode changes
    useEffect(() => {
        const checkDark = () => {
            setIsDark(document.documentElement.classList.contains("dark"));
        };
        checkDark();
        const observer = new MutationObserver(checkDark);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    // Fetch filtered stats
    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                let url = "/api/scan/news/stats";
                const params = new URLSearchParams();
                if (search.trim()) params.append("search", search);
                if (dateFilter) params.append("date", dateFilter);
                
                const queryStr = params.toString();
                if (queryStr) url += `?${queryStr}`;

                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    setStats(data);
                }
            } catch (err) {
                console.error("Error fetching news statistics:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [search, dateFilter]);

    if (loading) {
        return (
            <div className="p-8 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.45)] mb-8 flex justify-center items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
                <span className="text-xs font-black uppercase tracking-wider text-black dark:text-white">
                    {isAr ? "جاري تحميل وتصفية الإحصائيات..." : "Loading & filtering statistics..."}
                </span>
            </div>
        );
    }

    if (!stats || stats.summary.total === 0) {
        return (
            <div className="p-6 border-4 border-dashed border-black/20 dark:border-white/20 bg-zinc-50 dark:bg-zinc-900/20 text-center mb-8">
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                    {isAr ? "لا توجد إحصائيات كافية للفلاتر المحددة." : "No statistics available for the selected filters."}
                </span>
            </div>
        );
    }

    // Dynamic Colors based on Dark Mode
    const textColor = isDark ? "#ffffff" : "#000000";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)";
    const chartStroke = isDark ? "#ffffff" : "#000000";

    const sentimentColors = {
        positive: "#00FF66", // Green
        negative: "#FF3366", // Red
        neutral: "#FFE600"    // Yellow
    };

    const pieData = [
        { name: isAr ? "إيجابي" : "Positive", value: stats.summary.positive, color: sentimentColors.positive },
        { name: isAr ? "محايد" : "Neutral", value: stats.summary.neutral, color: sentimentColors.neutral },
        { name: isAr ? "سلبي" : "Negative", value: stats.summary.negative, color: sentimentColors.negative }
    ];

    const sectorChartData = stats.sectors.map(s => ({
        name: isAr ? s.nameAr : s.nameEn,
        sentiment: s.averageSentiment,
        news: s.newsCount
    }));

    return (
        <div className="space-y-8 mb-8" dir={isAr ? "rtl" : "ltr"}>
            {/* Top statistics section title */}
            <div className="flex items-center gap-2 mb-4 pb-2 border-b-4 border-black dark:border-white">
                <BarChart3 className="w-6 h-6 text-black dark:text-white" />
                <h2 className="text-lg font-black uppercase tracking-tight text-black dark:text-white">
                    {isAr ? "إحصائيات مشاعر السوق والقطاعات" : "Market & Sector Sentiment Analytics"}
                </h2>
            </div>

            {/* Grid for Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* 1. Market Sentiment Distribution (Pie Chart) */}
                <div className="lg:col-span-4 p-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.45)]">
                    <h3 className="text-xs font-black uppercase tracking-wider text-black dark:text-white mb-4 flex items-center gap-1.5 border-b-2 border-black/10 dark:border-white/10 pb-2">
                        <PieIcon className="w-4 h-4 text-yellow-500" />
                        {isAr ? "توزيع مشاعر الأخبار العامة" : "Overall Sentiment Distribution"}
                    </h3>
                    <div className="h-56 relative flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={entry.color} 
                                            stroke={isDark ? "#18181b" : "#000000"} 
                                            strokeWidth={3} 
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: isDark ? "#18181b" : "#ffffff",
                                        border: `3px solid ${textColor}`,
                                        borderRadius: "0px",
                                        fontFamily: "monospace",
                                        fontWeight: "bold",
                                        color: textColor
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex justify-center gap-4 mt-2">
                        {pieData.map((d, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs font-black text-black dark:text-white">
                                <span 
                                    className="w-3.5 h-3.5 border-2 border-black dark:border-white inline-block shadow-[1px_1px_0px_rgba(0,0,0,1)]" 
                                    style={{ backgroundColor: d.color }} 
                                />
                                <span>{d.name}: {d.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. Sentiment History / Timeline (Line Chart) */}
                <div className="lg:col-span-8 p-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.45)]">
                    <h3 className="text-xs font-black uppercase tracking-wider text-black dark:text-white mb-4 flex items-center gap-1.5 border-b-2 border-black/10 dark:border-white/10 pb-2">
                        <LineIcon className="w-4 h-4 text-yellow-500" />
                        {isAr ? "مؤشر نبض السوق اليومي (آخر 15 جلسة)" : "Daily Market Sentiment Trend (Last 15 Sessions)"}
                    </h3>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={stats.timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                <XAxis 
                                    dataKey="date" 
                                    stroke={chartStroke}
                                    tick={{ fill: textColor, fontSize: 9, fontWeight: "bold" }} 
                                />
                                <YAxis 
                                    stroke={chartStroke} 
                                    domain={[-1, 1]}
                                    tick={{ fill: textColor, fontSize: 9, fontWeight: "bold" }} 
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: isDark ? "#18181b" : "#ffffff",
                                        border: `3px solid ${textColor}`,
                                        borderRadius: "0px",
                                        fontFamily: "monospace",
                                        fontWeight: "bold",
                                        color: textColor
                                    }}
                                />
                                <ReferenceLine y={0} stroke={chartStroke} strokeWidth={2} strokeDasharray="3 3" />
                                <Line 
                                    type="monotone" 
                                    dataKey="averageSentiment" 
                                    name={isAr ? "متوسط مشاعر السوق" : "Avg Sentiment"} 
                                    stroke="#00FF66" 
                                    strokeWidth={4}
                                    dot={{ stroke: chartStroke, strokeWidth: 2, r: 4, fill: '#fff' }}
                                    activeDot={{ stroke: chartStroke, strokeWidth: 3, r: 6, fill: '#00FF66' }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>

            {/* 3. Sector Sentiment Breakdown (Bar Chart) */}
            <div className="p-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.45)]">
                <h3 className="text-xs font-black uppercase tracking-wider text-black dark:text-white mb-4 flex items-center gap-1.5 border-b-2 border-black/10 dark:border-white/10 pb-2">
                    <TrendingUp className="w-4 h-4 text-yellow-500" />
                    {isAr ? "مقارنة مشاعر القطاعات بناءً على الأخبار" : "Sector Sentiment Comparison"}
                </h3>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sectorChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                            <XAxis 
                                dataKey="name" 
                                stroke={chartStroke}
                                tick={{ fill: textColor, fontSize: 9, fontWeight: "bold" }}
                                interval={0}
                                angle={-15}
                                textAnchor="end"
                            />
                            <YAxis 
                                stroke={chartStroke} 
                                domain={[-1, 1]}
                                tick={{ fill: textColor, fontSize: 9, fontWeight: "bold" }} 
                            />
                            <Tooltip
                                contentStyle={{
                                    background: isDark ? "#18181b" : "#ffffff",
                                    border: `3px solid ${textColor}`,
                                    borderRadius: "0px",
                                    fontFamily: "monospace",
                                    fontWeight: "bold",
                                    color: textColor
                                }}
                            />
                            <ReferenceLine y={0} stroke={chartStroke} strokeWidth={2} strokeDasharray="3 3" />
                            <Bar 
                                dataKey="sentiment" 
                                name={isAr ? "مشاعر القطاع" : "Sector Sentiment"}
                                stroke={chartStroke}
                                strokeWidth={3}
                            >
                                {sectorChartData.map((entry, index) => {
                                    const color = entry.sentiment > 0.15 
                                        ? sentimentColors.positive 
                                        : entry.sentiment < -0.15 
                                            ? sentimentColors.negative 
                                            : sentimentColors.neutral;
                                    return <Cell key={`cell-${index}`} fill={color} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
