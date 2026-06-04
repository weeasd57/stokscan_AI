"use client";

import { useState, useEffect } from "react";
import { Check, Zap, Star, Shield, Crown, Loader2, CreditCard, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import Link from "next/link";
import { useMemo } from "react";

interface Plan {
    id: string; // from pricing_plans
    name: string;
    price: number | string;
    period?: string;
    desc: string;
    features: string[] | Record<string, any>;
    featured?: boolean;
    button_text?: string;
    current?: boolean;
}

interface Subscription {
    plan_id: string;
    status: string;
    current_period_end: string | null;
}

export default function ProPage() {
    const { t } = useLanguage();
    const { user } = useAuth();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const [plans, setPlans] = useState<Plan[]>([]);
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Paymob Checkout States
    const [showModal, setShowModal] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("01010101010");
    const [isGeneratingCheckout, setIsGeneratingCheckout] = useState(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);

    const handleCancelSubscription = async () => {
        if (!user || !subscription) return;
        
        if (!confirm("Are you sure you want to cancel your subscription? This will immediately downgrade your account to the Free plan.")) {
            return;
        }

        setIsCancelling(true);
        try {
            const res = await fetch("/api/payment/paymob/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: user.id })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Failed to cancel subscription");
            }

            alert("Subscription cancelled successfully. Your plan has been downgraded to Free.");
            setSubscription(null);
        } catch (err: any) {
            alert(err.message || "An error occurred while cancelling your subscription.");
        } finally {
            setIsCancelling(false);
        }
    };

    const handlePlanSelect = (plan: Plan) => {
        if (!user) {
            alert("Please login first to upgrade your subscription.");
            return;
        }
        if (subscription?.plan_id === plan.name) {
            return;
        }
        if (plan.name.toLowerCase() === "free") {
            return;
        }
        setSelectedPlan(plan);
        setShowModal(true);
    };

    const handleStartPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !selectedPlan) return;

        setIsGeneratingCheckout(true);
        try {
            const res = await fetch("/api/payment/paymob/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    plan_id: selectedPlan.name,
                    user_id: user.id,
                    email: user.email || "",
                    first_name: firstName,
                    last_name: lastName,
                    phone_number: phoneNumber
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Checkout generation failed");
            }

            const data = await res.json();
            if (data.url) {
                if (data.is_wallet) {
                    window.open(data.url, "_blank");
                    alert("Redirecting to Mobile Wallet simulator... Please complete payment in the new window, then refresh this page.");
                    setShowModal(false);
                } else {
                    setIframeUrl(data.url);
                }
            } else {
                throw new Error("No checkout URL returned from server");
            }
        } catch (err: any) {
            alert(err.message || "An error occurred while preparing your checkout session.");
        } finally {
            setIsGeneratingCheckout(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        async function loadData() {
            setLoading(true);
            try {
                // 1. Fetch plans (from API or direct from Supabase)
                // We'll keep the API call as it likely returns the nicely formatted data,
                // but we also need the plan IDs from Supabase table pricing_plans if we want to match subscriptions.
                const res = await fetch("/api/admin/plans");
                const data = await res.json();

                if (Array.isArray(data) && !cancelled) {
                    setPlans(data);
                }

                // 2. Fetch subscription and profile if user is logged in
                if (user) {
                    const { data: subRow } = await supabase
                        .from("subscriptions")
                        .select("plan_id, status, current_period_end")
                        .eq("user_id", user.id)
                        .maybeSingle();

                    if (!cancelled) setSubscription((subRow ?? null) as any);

                    // Fetch profile to prefill payment billing details
                    const { data: profileRow } = await supabase
                        .from("profiles")
                        .select("display_name, whatsapp_number")
                        .eq("id", user.id)
                        .maybeSingle();

                    if (!cancelled && profileRow) {
                        const name = (profileRow.display_name || "").trim();
                        if (name) {
                            const parts = name.split(" ");
                            if (parts.length >= 2) {
                                setFirstName(parts[0]);
                                setLastName(parts.slice(1).join(" "));
                            } else {
                                setFirstName(name);
                            }
                        }
                        // Keep 01010101010 as default test number for sandbox wallet
                        setPhoneNumber("01010101010");
                    }
                }
            } catch (err) {
                console.error("Failed to fetch pro data:", err);
                if (!cancelled) setError("Failed to load pro dashboard");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadData();
        return () => { cancelled = true; };
    }, [user, supabase]);

    const getIcon = (name: string) => {
        switch (name?.toLowerCase()) {
            case 'free': return <Star className="w-6 h-6 text-zinc-400" />;
            case 'pro': return <Zap className="w-6 h-6 text-indigo-400" />;
            case 'enterprise': return <Crown className="w-6 h-6 text-amber-400" />;
            default: return <Star className="w-6 h-6 text-zinc-400" />;
        }
    };

    if (loading && plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Synchronizing Plans...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-16 pb-20 max-w-[1200px] mx-auto pt-2">
            <header className="text-center space-y-4">
                <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic">
                    Upgrade to <span className="text-indigo-500">Pro</span>
                </h1>
                <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
                    Unlock the full power of AI-driven market analysis and stay ahead of the curve.
                </p>

                {/* Subscription Status Banner */}
                <div className="pt-6">
                    {user ? (
                        <div className="inline-flex flex-col items-center gap-2 p-6 rounded-[2rem] border border-white/5 bg-zinc-900/30 backdrop-blur-xl animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="flex items-center gap-3 text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em]">
                                <CreditCard className="w-4 h-4 text-indigo-500" />
                                Your Subscription
                            </div>
                            <div className="text-sm text-zinc-200 font-bold flex flex-col items-center gap-4 mt-1">
                                {subscription ? (
                                    <div className="flex flex-col sm:flex-row items-center gap-4">
                                        <div className="flex items-center gap-3">
                                            <span className="px-3 py-1 rounded-full bg-indigo-500 text-white text-[10px] uppercase font-black">
                                                {subscription.plan_id}
                                            </span>
                                            <span className="text-zinc-500 font-medium tracking-widest uppercase text-[10px]">
                                                Status: {subscription.status}
                                            </span>
                                        </div>
                                        {subscription.status === "active" && (
                                            <button
                                                onClick={handleCancelSubscription}
                                                disabled={isCancelling}
                                                className="px-4 py-1.5 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                                            >
                                                {isCancelling ? "Cancelling..." : "Cancel Subscription"}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-zinc-600 italic">No active subscription found.</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="inline-flex items-center gap-4 p-4 px-6 rounded-2xl border border-white/5 bg-zinc-900/30 text-xs font-bold text-zinc-400">
                            Login into your account to manage subscriptions
                            <Link href="/login" className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-all">
                                Login
                            </Link>
                        </div>
                    )}
                </div>
            </header>

            {error && (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-center max-w-md mx-auto text-sm font-bold animate-in fade-in zoom-in duration-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-4 max-w-4xl mx-auto">
                {plans.map((plan, i) => (
                    <div
                        key={i}
                        className={`
              relative flex flex-col p-8 rounded-[3rem] border transition-all duration-500
              ${plan.featured
                                ? "bg-gradient-to-br from-indigo-950/40 via-zinc-950/40 to-zinc-950 border-indigo-500/30 shadow-2xl shadow-indigo-600/10 scale-105 z-10"
                                : "bg-zinc-950/40 border-white/5 hover:border-white/10"
                            }
            `}
                    >
                        {plan.featured && (
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-indigo-600 text-[10px] font-black uppercase tracking-widest rounded-full text-white shadow-lg shadow-indigo-600/40">
                                Most Popular
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-8">
                            <div className={`p-4 rounded-2xl ${plan.featured ? "bg-indigo-600/20" : "bg-zinc-900/50"}`}>
                                {getIcon(plan.name)}
                            </div>
                            <div className="text-right">
                                <div className="text-3xl font-black text-white">${plan.price}</div>
                                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                    {plan.period === 'forever' ? 'forever' : `/${plan.period || 'month'}`}
                                </div>
                            </div>
                        </div>

                        <h2 className="text-2xl font-black text-white mb-2">{plan.name}</h2>
                        <p className="text-sm text-zinc-500 mb-8">{plan.desc}</p>

                        <ul className="space-y-4 flex-1 mb-10">
                            {(Array.isArray(plan.features) ? plan.features : Object.keys(plan.features)).map((feat, j) => (
                                <li key={j} className="flex items-start gap-3 text-sm text-zinc-300">
                                    <div className={`mt-0.5 p-0.5 rounded-full ${plan.featured ? "bg-indigo-500/20 text-indigo-400" : "bg-zinc-800 text-zinc-500"}`}>
                                        <Check className="w-3.5 h-3.5" />
                                    </div>
                                    <span>{typeof feat === 'string' ? feat : String(feat)}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            onClick={() => handlePlanSelect(plan)}
                            className={`
                w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all
                ${plan.featured
                                    ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 active:scale-95"
                                    : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 active:scale-95"
                                }
                ${subscription?.plan_id === plan.name ? "opacity-30 cursor-default" : ""}
              `}
                        >
                            {subscription?.plan_id === plan.name ? "Current Plan" : (plan.button_text || "Choose Plan")}
                        </button>
                    </div>
                ))}
            </div>

            <section className="mt-10 rounded-[3rem] border border-white/5 bg-zinc-950/40 p-12 text-center space-y-8">
                <div className="flex justify-center gap-4">
                    <Shield className="w-12 h-12 text-emerald-500" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-black text-white uppercase italic">Secure & Trusted</h2>
                    <p className="text-zinc-500 max-w-xl mx-auto text-sm">
                        We use industry-standard encryption and security protocols to ensure your data and payments are always safe. No hidden fees, cancel anytime.
                    </p>
                    <p className="text-[10px] text-zinc-800 font-bold uppercase tracking-[0.3em] mt-4">
                        Payments are not wired yet. This dashboard reflects stored plans and subscriptions.
                    </p>
                </div>
            </section>

            {/* Payment Modal */}
            {showModal && selectedPlan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl shadow-indigo-500/10 flex flex-col max-h-[90vh] overflow-y-auto">
                        <button 
                            onClick={() => {
                                setShowModal(false);
                                setIframeUrl(null);
                            }}
                            className="absolute top-6 right-6 p-2 rounded-xl bg-zinc-900 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        {!iframeUrl ? (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-2xl font-black text-white uppercase italic">Complete Subscription</h3>
                                    <p className="text-zinc-500 text-xs mt-1">Plan: <span className="text-indigo-400 font-bold uppercase">{selectedPlan.name}</span> — Price: <span className="text-white font-bold">${selectedPlan.price}/month</span></p>
                                </div>

                                <form onSubmit={handleStartPayment} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">First Name</label>
                                            <input 
                                                type="text" 
                                                required
                                                value={firstName}
                                                onChange={e => setFirstName(e.target.value)}
                                                placeholder="e.g. Ahmad"
                                                className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Last Name</label>
                                            <input 
                                                type="text" 
                                                required
                                                value={lastName}
                                                onChange={e => setLastName(e.target.value)}
                                                placeholder="e.g. Ali"
                                                className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Phone Number</label>
                                        <input 
                                            type="tel" 
                                            required
                                            value={phoneNumber}
                                            onChange={e => setPhoneNumber(e.target.value)}
                                            placeholder="e.g. +2010xxxxxxxx"
                                            className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Email Address</label>
                                        <input 
                                            type="email" 
                                            disabled
                                            value={user?.email || ""}
                                            className="w-full px-4 py-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50 text-sm text-zinc-500 cursor-not-allowed"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isGeneratingCheckout}
                                        className="w-full py-4 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                                    >
                                        {isGeneratingCheckout ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Preparing Checkout...
                                            </>
                                        ) : (
                                            "Pay with Card / Wallet"
                                        )}
                                    </button>
                                </form>
                            </div>
                        ) : (
                            <div className="space-y-6 flex-1 flex flex-col">
                                <div>
                                    <h3 className="text-xl font-black text-white uppercase italic">Paymob Secure Checkout</h3>
                                    <p className="text-zinc-500 text-xs mt-1">Complete your payment details inside the secure frame below.</p>
                                </div>
                                <div className="relative rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 flex-1 min-h-[500px]">
                                    <iframe 
                                        src={iframeUrl} 
                                        className="absolute inset-0 w-full h-full border-0" 
                                        allow="payment"
                                    />
                                </div>
                                <div className="text-center text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
                                    Close this window and refresh the dashboard once payment succeeds.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
