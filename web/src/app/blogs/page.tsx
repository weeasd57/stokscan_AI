"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { BookOpen, Calendar, User, ArrowRight, X } from "lucide-react";
import { useState } from "react";

interface Post {
    title: string;
    excerpt: string;
    date: string;
    author: string;
    category: string;
    content: React.ReactNode;
}

export default function BlogsPage() {
    const { t } = useLanguage();
    const [selectedPost, setSelectedPost] = useState<Post | null>(null);

    const posts: Post[] = [
        {
            title: "Algorithmic Integrity: Preventing Look-Ahead Bias & Cheating in AI Backtesting",
            excerpt: "A comprehensive audit of our backtesting engine to guarantee zero look-ahead bias, future data leaks, or performance inflation.",
            date: "May 29, 2026",
            author: "Security & QA Team",
            category: "Core Engineering",
            content: (
                <div className="space-y-6 text-zinc-300 text-sm leading-relaxed">
                    <p>
                        In algorithmic trading, <strong>&quot;cheating&quot;</strong> (look-ahead bias or future data leakage) is the most common reason why strategies perform exceptionally well in simulations but fail in live trading. We have conducted a rigorous audit of the <strong>Stokscan AI</strong> backtesting and model training systems to guarantee absolute integrity.
                    </p>
                    
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">1. Predictors & Feature Engineering</h3>
                    <p>
                        All technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, etc.) and historical memory features (Lags) are computed strictly using historical or current close prices. Positive shifts (e.g., <code>shift(1)</code>) ensure that today&apos;s model predictions only have access to information available up to today&apos;s market close. No future data is referenced in feature generation.
                    </p>

                    <h3 className="text-lg font-black text-white uppercase italic mt-6">2. StandardScaler & PCA Pipelines</h3>
                    <p>
                        Data scaling and dimensionality reduction (PCA) are wrapped in our custom <code>QuantitativeModelPipeline</code>. The scaler and PCA models are fitted <em>only</em> on the training subset. During backtest simulations and live scanner operations, they use <code>.transform()</code>, preventing any validation/testing data from leaking into the model&apos;s mathematical transforms.
                    </p>

                    <h3 className="text-lg font-black text-white uppercase italic mt-6">3. Target Labeling & Embargo Purging</h3>
                    <p>
                        We use the <strong>Triple Barrier Method</strong> for training labels. While it utilizes a future shift (<code>shift(-1)</code>) to determine if a trade will hit its Target Profit (TP) before its Stop Loss (SL), this shift is used <em>solely</em> to construct target labels (Y) for supervised training. 
                    </p>
                    <p>
                        Furthermore, we apply <strong>Purged/Embargo K-Fold Validation</strong>. The training sequence is split chronologically, and a gap equal to the trade holding period (e.g., 20 days) is deleted at the split boundaries to eliminate any overlap or information leakage between train and test datasets.
                    </p>

                    <h3 className="text-lg font-black text-white uppercase italic mt-6">4. Realistic Trade Simulation Loop</h3>
                    <ul className="list-disc pl-6 space-y-3">
                        <li>
                            <strong className="text-white">Execution Timing</strong>: Trades are triggered based on close prices of day <code>i</code> and evaluated starting on day <code>i+1</code>. No same-day entry and exit are allowed, reflecting real-world execution.
                        </li>
                        <li>
                            <strong className="text-white">Conservative Same-Bar Evaluation</strong>: If both the Target Profit and Stop Loss levels are breached on the same day, the backtester prioritizes the stop-loss first (exiting as a loss rather than a win).
                        </li>
                        <li>
                            <strong className="text-white">Trailing Stop Logic</strong>: Trailing stop updates are calculated at the end of each bar and apply only starting on the <em>next</em> bar, eliminating same-bar exit bias.
                        </li>
                    </ul>
                </div>
            )
        },
        {
            title: "How AI is Revolutionizing Stock Market Predictions",
            excerpt: "Explore the internal workings of RandomForest models and how they identify non-linear patterns in market data...",
            date: "May 15, 2026",
            author: "Dr. Analyst",
            category: "AI & Tech",
            content: (
                <div className="space-y-6 text-zinc-300 text-sm leading-relaxed">
                    <p>
                        For decades, quantitative traders relied on simple linear regressions and moving averages. Today, machine learning algorithms like <strong>Random Forest Classifiers</strong> and Gradient Boosted Trees (XGBoost, LightGBM) are changing the landscape by identifying complex, non-linear relationships in multi-dimensional market data.
                    </p>
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">Why Random Forests?</h3>
                    <p>
                        Random Forests work by training hundreds of decision trees on random subsets of features and data. Unlike deep neural networks, they are highly robust to overfitting, require minimal hyperparameter tuning, and provide clear <em>feature importance</em> metrics. This allows analysts to understand exactly which indicators (like RSI divergence or volume spikes) are driving the model&apos;s predictions.
                    </p>
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">The Multidimensional Advantage</h3>
                    <p>
                        Instead of looking at RSI in isolation, the AI model combines fundamentals (P/E ratio, market cap) with technicals and market regimes. For example, a model might learn that a 14-day RSI of 25 is a strong buy signal <em>only</em> if the stock is a mid-cap, trading above its 200-day moving average, and market volatility is low.
                    </p>
                </div>
            )
        },
        {
            title: "Understanding Technical Indicators in the Modern Era",
            excerpt: "RSI, MACD, and Bollinger Bands are classic, but are they still relevant when combined with neural networks?",
            date: "May 10, 2026",
            author: "Market Guru",
            category: "Analysis",
            content: (
                <div className="space-y-6 text-zinc-300 text-sm leading-relaxed">
                    <p>
                        RSI, MACD, and Bollinger Bands were created in the era of paper charting and manual calculations. While they are still valuable, their predictive power increases exponentially when processed by modern machine learning models.
                    </p>
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">From Fixed Thresholds to Dynamic Learning</h3>
                    <p>
                        Traditional strategy dictates buying when RSI falls below 30 and selling above 70. However, in strong trends, RSI can remain overbought or oversold for weeks. AI models do not rely on static thresholds. They analyze the rate of change, standard deviations, and correlations across multiple timeframes to dynamically adapt these indicators to current market regimes.
                    </p>
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">Stacked Indicator Classifiers</h3>
                    <p>
                        By stacking technical indicators, models can identify hidden combinations that human traders miss. For instance, the convergence of a squeeze in Bollinger Bands (representing low volatility) with a MACD histogram crossing zero can signal a massive impending breakout. Machine learning classifiers excel at mapping these joint probability distributions.
                    </p>
                </div>
            )
        },
        {
            title: "Top 5 AI Stocks to Watch for Q3 2026",
            excerpt: "Our models have flagged these five giants as potentially undervalued based on fundamental and sentiment analysis...",
            date: "May 05, 2026",
            author: "Investment Team",
            category: "Top Picks",
            content: (
                <div className="space-y-6 text-zinc-300 text-sm leading-relaxed">
                    <p>
                        As we approach the third quarter of 2026, our proprietary machine learning models have analyzed fundamental, technical, and macro indicators to rank potential AI sector leaders.
                    </p>
                    <h3 className="text-lg font-black text-white uppercase italic mt-6">Our Selection Criteria</h3>
                    <p>
                        The model filters companies using a combination of growth metrics (quarterly revenue growth &gt; 25%), profitability (Operating Margin &gt; 20%), and strong technical support. Here are the top picks flagged by our models:
                    </p>
                    <ol className="list-decimal pl-6 space-y-3 mt-4">
                        <li>
                            <strong className="text-white">NVIDIA Corp (NVDA)</strong>: Continuing dominance in enterprise AI chips, trading at a major support level.
                        </li>
                        <li>
                            <strong className="text-white">Microsoft Corp (MSFT)</strong>: Strong growth in cloud Azure AI revenues and Copilot enterprise subscriptions.
                        </li>
                        <li>
                            <strong className="text-white">Palantir Technologies (PLTR)</strong>: Massive customer expansion in their Artificial Intelligence Platform (AIP).
                        </li>
                        <li>
                            <strong className="text-white">Arista Networks (ANET)</strong>: The backbone of high-performance AI data center networking.
                        </li>
                        <li>
                            <strong className="text-white">Broadcom Inc (AVGO)</strong>: Custom AI ASIC chip partnerships showing accelerating volume.
                        </li>
                    </ol>
                </div>
            )
        }
    ];

    const openPost = (post: Post) => {
        setSelectedPost(post);
    };

    return (
        <div className="flex flex-col gap-12 pb-20 pt-10 relative">
            <header className="space-y-4 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                    <BookOpen className="w-3 h-3" />
                    Market Blogs & Insights
                </div>
                <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic">
                    Expert <span className="text-indigo-500">Analysis</span>
                </h1>
                <p className="text-zinc-500 text-lg leading-relaxed">
                    Deep dives into market trends, algorithmic strategies, and the future of AI-driven finance.
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {posts.map((post, i) => (
                    <div 
                        key={i} 
                        onClick={() => openPost(post)}
                        className="group relative flex flex-col p-8 rounded-[2.5rem] border border-white/5 bg-zinc-950/40 hover:border-white/10 hover:bg-zinc-900/20 transition-all duration-500 cursor-pointer"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{post.category}</span>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                                <Calendar className="w-3 h-3" />
                                {post.date}
                            </div>
                        </div>

                        <h2 className="text-xl font-bold text-white mb-4 group-hover:text-indigo-400 transition-colors leading-tight line-clamp-2">
                            {post.title}
                        </h2>

                        <p className="text-sm text-zinc-500 mb-8 flex-1 leading-relaxed line-clamp-3">
                            {post.excerpt}
                        </p>

                        <div className="flex items-center justify-between mt-auto pt-6 border-t border-white/5">
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                                    {post.author[0]}
                                </div>
                                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{post.author}</span>
                            </div>
                            <button className="p-2 rounded-xl bg-white/5 text-white hover:bg-indigo-600 transition-all flex items-center justify-center group/btn">
                                <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal for viewing the full post */}
            {selectedPost && (
                <div 
                    className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 md:p-8 z-[9999] animate-in fade-in duration-300"
                    onClick={() => setSelectedPost(null)}
                >
                    <div 
                        className="bg-zinc-950 border border-white/10 rounded-[2.5rem] p-8 md:p-10 max-w-5xl w-full max-h-[90vh] overflow-y-auto relative animate-in zoom-in-95 duration-300 flex flex-col gap-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header Details */}
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                                    {selectedPost.category}
                                </span>
                                <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                                    <Calendar className="w-3 h-3" />
                                    {selectedPost.date}
                                </div>
                            </div>
                        </div>

                        {/* Title */}
                        <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-tight uppercase italic pr-8">
                            {selectedPost.title}
                        </h2>

                        {/* Author */}
                        <div className="flex items-center gap-3 pb-6 border-b border-white/5">
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300">
                                {selectedPost.author[0]}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{selectedPost.author}</span>
                                <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">Author</span>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto pr-2">
                            {selectedPost.content}
                        </div>

                        {/* Close button */}
                        <button 
                            onClick={() => setSelectedPost(null)}
                            className="absolute top-6 right-6 p-2 rounded-xl bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                            aria-label="Close dialog"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            <section className="mt-12 p-12 rounded-[3rem] border border-white/5 bg-indigo-600/5 relative overflow-hidden text-center space-y-6">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 blur-[100px] -z-10 rounded-full" />
                <h2 className="text-2xl font-black text-white italic uppercase">Stay Updated</h2>
                <p className="text-zinc-500 max-w-lg mx-auto text-sm leading-relaxed">
                    Subscribe to our newsletter to receive the latest market insights and algorithmic predictions directly in your inbox.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                    <input
                        type="email"
                        placeholder="your@email.com"
                        className="flex-1 h-12 rounded-2xl bg-zinc-950/50 border border-white/5 px-4 text-sm text-white outline-none focus:border-indigo-500/50 transition-all"
                    />
                    <button className="h-12 px-8 rounded-2xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 active:scale-95">
                        Subscribe
                    </button>
                </div>
            </section>
        </div>
    );
}
