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
    Legend,
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
}

export default function NewsStats({ isAr }: NewsStatsProps) {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch("/api/scan/news/stats");
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
    }, []);

    if (loading) {
        return (
            <div className="p-8 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.45)] mb-8 flex justify-center items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
                <span className="text-xs font-black uppercase tracking-wider text-black dark:text-white">
                    {isAr ? "جاري تحميل إحصائيات الأخبار والقطاعات..." : "Loading news & sector statistics..."}
                </span>
            </div>
        );
    }

    if (!stats || stats.summary.total === 0) {
        return null;
    }

    // Colors for pie chart
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

    // Format sector data for Bar Chart
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
                                            stroke="#000" 
                                            strokeWidth={3} 
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: "white",
                                        border: "3px solid black",
                                        borderRadius: "0px",
                                        fontFamily: "monospace",
                                        fontWeight: "bold",
                                        color: "black"
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
                                    className="w-3.5 h-3.5 border-2 border-black inline-block shadow-[1px_1px_0px_rgba(0,0,0,1)]" 
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
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
                                <XAxis 
                                    dataKey="date" 
                                    stroke="#000"
                                    tick={{ fontSize: 9, fontWeight: "bold" }} 
                                />
                                <YAxis 
                                    stroke="#000" 
                                    domain={[-1, 1]}
                                    tick={{ fontSize: 9, fontWeight: "bold" }} 
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: "white",
                                        border: "3px solid black",
                                        borderRadius: "0px",
                                        fontFamily: "monospace",
                                        fontWeight: "bold",
                                        color: "black"
                                    }}
                                />
                                <ReferenceLine y={0} stroke="#000" strokeWidth={2} strokeDasharray="3 3" />
                                <Line 
                                    type="monotone" 
                                    dataKey="averageSentiment" 
                                    name={isAr ? "متوسط مشاعر السوق" : "Avg Sentiment"} 
                                    stroke="#00FF66" 
                                    strokeWidth={4}
                                    dot={{ stroke: '#000', strokeWidth: 2, r: 4, fill: '#fff' }}
                                    activeDot={{ stroke: '#000', strokeWidth: 3, r: 6, fill: '#00FF66' }}
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
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
                            <XAxis 
                                dataKey="name" 
                                stroke="#000"
                                tick={{ fontSize: 9, fontWeight: "bold" }}
                                interval={0}
                                angle={-15}
                                textAnchor="end"
                            />
                            <YAxis 
                                stroke="#000" 
                                domain={[-1, 1]}
                                tick={{ fontSize: 9, fontWeight: "bold" }} 
                            />
                            <Tooltip
                                contentStyle={{
                                    background: "white",
                                    border: "3px solid black",
                                    borderRadius: "0px",
                                    fontFamily: "monospace",
                                    fontWeight: "bold",
                                    color: "black"
                                }}
                            />
                            <ReferenceLine y={0} stroke="#000" strokeWidth={2} strokeDasharray="3 3" />
                            <Bar 
                                dataKey="sentiment" 
                                name={isAr ? "مشاعر القطاع" : "Sector Sentiment"}
                                stroke="#000"
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
