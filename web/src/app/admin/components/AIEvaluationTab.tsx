"use client";

import { useState } from "react";
import { Play, CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface TestResult {
    testId: string;
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
    evidence: string;
    duration: number;
    aiResponse: string;
}

export function AIEvaluationTab() {
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const [runningTestId, setRunningTestId] = useState<string | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    const runTestSuite = async () => {
        if (isRunning) return;
        setIsRunning(true);
        setResults({});
        setProgress({ current: 0, total: 0 });
        setRunningTestId(null);

        try {
            const response = await fetch("/api/admin/ai-evaluation", {
                method: "POST"
            });

            if (!response.ok) {
                throw new Error(`Failed to start evaluation: ${response.statusText}`);
            }
            if (!response.body) {
                throw new Error("No response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.status === "started") {
                                    setProgress({ current: 0, total: data.total });
                                } else if (data.status === "running") {
                                    setRunningTestId(data.testId);
                                } else if (data.status === "completed") {
                                    setResults(prev => ({
                                        ...prev,
                                        [data.testId]: data
                                    }));
                                    setProgress(p => ({ ...p, current: p.current + 1 }));
                                    setRunningTestId(null);
                                } else if (data.status === "finished") {
                                    toast.success("تم الانتهاء من جميع الاختبارات بنجاح");
                                }
                            } catch (e) {
                                console.error("Error parsing SSE data", e);
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsRunning(false);
            setRunningTestId(null);
        }
    };

    const resultsList = Object.values(results);
    const passedCount = resultsList.filter(r => r.passed).length;
    const isFinished = progress.total > 0 && progress.current === progress.total;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold font-tajawal text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <AlertCircle className="h-6 w-6 text-amber-500" />
                        AI Semantic Evaluation Suite
                    </h2>
                    <p className="text-zinc-500 text-sm mt-1">
                        Run strict deterministic edge cases (Mocked DB State) to verify semantic logic and anti-hallucination.
                    </p>
                </div>
                <button
                    onClick={runTestSuite}
                    disabled={isRunning}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#FFE600] text-black font-bold rounded-xl shadow-[4px_4px_0_0_#000] border-2 border-black hover:translate-y-1 hover:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-black" />}
                    {isRunning ? "جارِ التقييم..." : "Run Test Suite"}
                </button>
            </div>

            {progress.total > 0 && (
                <div className="bg-white dark:bg-zinc-900 border-2 border-black dark:border-zinc-800 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-center mb-2 font-bold font-tajawal">
                        <span>التقدم ({progress.current} / {progress.total})</span>
                        {isFinished ? (
                            <span className={passedCount === progress.total ? "text-green-600" : "text-amber-600"}>
                                النتيجة: {passedCount} / {progress.total} نجاح
                            </span>
                        ) : (
                            <span className="text-blue-600 animate-pulse">يتم الاختبار...</span>
                        )}
                    </div>
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-300 dark:border-zinc-700">
                        <div 
                            className={`h-full transition-all duration-500 ${isFinished ? (passedCount === progress.total ? 'bg-green-500' : 'bg-amber-500') : 'bg-blue-500'}`} 
                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="grid gap-4">
                {resultsList.map((res) => (
                    <div key={res.testId} className={`p-4 border-l-4 rounded-r-xl border-y border-r bg-white dark:bg-zinc-900 ${res.passed ? 'border-l-green-500 border-y-green-500/20 border-r-green-500/20' : 'border-l-red-500 border-y-red-500/20 border-r-red-500/20'}`}>
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                {res.passed ? <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" /> : <XCircle className="h-6 w-6 text-red-500 shrink-0" />}
                                <div>
                                    <h3 className="font-bold text-lg font-tajawal">{res.name}</h3>
                                    <p className="text-xs text-zinc-500 font-mono mt-1">ID: {res.testId} • {res.duration}ms</p>
                                </div>
                            </div>
                            <span className={`px-3 py-1 text-xs font-bold rounded-lg border ${res.passed ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400'}`}>
                                {res.passed ? 'PASS' : 'FAIL'}
                            </span>
                        </div>
                        
                        <div className="mt-4 grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-xs font-bold text-zinc-500 mb-1">Expected Behavior</p>
                                    <p className="text-sm">{res.expected}</p>
                                </div>
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-xs font-bold text-zinc-500 mb-1">Actual Result</p>
                                    <p className={`text-sm font-medium ${res.passed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{res.actual}</p>
                                </div>
                            </div>
                            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 h-full">
                                <p className="text-xs font-bold text-zinc-500 mb-1">Evidence / AI Response</p>
                                <div className="text-xs text-zinc-700 dark:text-zinc-300 font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar">
                                    {res.aiResponse || "No response received."}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                
                {runningTestId && (
                    <div className="p-4 border-l-4 border-l-blue-500 border-y border-r border-zinc-200 dark:border-zinc-800 rounded-r-xl bg-white dark:bg-zinc-900 opacity-70">
                        <div className="flex items-center gap-3">
                            <RefreshCw className="h-6 w-6 text-blue-500 animate-spin shrink-0" />
                            <div>
                                <h3 className="font-bold text-lg font-tajawal">Running test: {runningTestId}...</h3>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
