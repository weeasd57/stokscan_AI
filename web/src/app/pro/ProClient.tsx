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
                // 1. Fetch plans
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
                if (!cancelled) setError("Failed to load pro plans");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadData();
        return () => { cancelled = true; };
    }, [user, supabase]);

    const getIcon = (name: string) => {
        switch (name?.toLowerCase()) {
            case 'free': return <Star className="w-6 h-6 text-black" />;
            case 'pro': return <Zap className="w-6 h-6 text-black" />;
            case 'enterprise': return <Crown className="w-6 h-6 text-black" />;
            default: return <Star className="w-6 h-6 text-black" />;
        }
    };

    if (loading && plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Synchronizing Plans...</p>
            </div>
        );
    }

    return (
        <div className="neobrutal-layout flex flex-col gap-16 pb-20 max-w-[1200px] mx-auto pt-2 px-4 md:px-8 min-h-screen neobrutal-grid-bg">
            <header className="text-center space-y-4 pt-8">
                <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)]">
                    Upgrade to <span className="inline-block border-4 border-black dark:border-white px-4 py-1 neobrutal-bg-yellow text-black rotate-[-1.5deg]">Pro</span>
                </h1>
                <p className="text-zinc-800 dark:text-zinc-300 max-w-2xl mx-auto text-base sm:text-lg font-bold">
                    Unlock the full power of AI-driven market analysis and stay ahead of the curve.
                </p>

                {/* Subscription Status Banner */}
                <div className="pt-6">
                    {user ? (
                        <div className="inline-flex flex-col items-center gap-2 p-6 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_0px_rgba(255,255,255,1)] transition-all">
                            <div className="flex items-center gap-3 text-zinc-650 dark:text-zinc-400 text-xs font-black uppercase tracking-[0.2em]">
                                <CreditCard className="w-4 h-4 text-indigo-500" />
                                Your Subscription
                            </div>
                            <div className="text-sm text-zinc-800 dark:text-zinc-200 font-black flex flex-col items-center gap-4 mt-2">
                                {subscription ? (
                                    <div className="flex flex-col sm:flex-row items-center gap-4">
                                        <div className="flex items-center gap-3">
                                            <span className="px-3 py-1 border-2 border-black bg-indigo-500 text-white text-xs uppercase font-black">
                                                {subscription.plan_id}
                                            </span>
                                            <span className="text-zinc-650 dark:text-zinc-400 font-black tracking-widest uppercase text-xs">
                                                Status: {subscription.status}
                                            </span>
                                        </div>
                                        {subscription.status === "active" && (
                                            <button
                                                onClick={handleCancelSubscription}
                                                disabled={isCancelling}
                                                className="px-4 py-1.5 border-2 border-black bg-red-500 text-white hover:bg-red-650 text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                            >
                                                {isCancelling ? "Cancelling..." : "Cancel Subscription"}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-zinc-500 italic font-bold">No active subscription found.</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="inline-flex flex-col sm:flex-row items-center gap-4 p-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] text-sm font-black text-black dark:text-white">
                            Login into your account to manage subscriptions
                            <Link href="/login" className="h-10 px-6 border-4 border-black bg-indigo-500 text-white font-black hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex items-center justify-center">
                                Login
                            </Link>
                        </div>
                    )}
                </div>
            </header>

            {error && (
                <div className="p-4 border-4 border-black dark:border-white bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-center max-w-md mx-auto text-sm font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    {error}
                </div>
            )}

            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-4 max-w-4xl mx-auto items-stretch">
                {plans.map((plan, i) => (
                    <div
                        key={i}
                        className={`
                            relative flex flex-col p-8 border-4 border-black dark:border-white transition-all duration-200
                            shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] 
                            hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]
                            ${plan.featured
                                ? "bg-amber-50 dark:bg-zinc-900 border-indigo-500 dark:border-indigo-400"
                                : "bg-white dark:bg-zinc-950"
                            }
                        `}
                    >
                        {plan.featured && (
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-4 py-1.5 border-4 border-black bg-indigo-600 text-[10px] font-black uppercase tracking-widest text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                                Most Popular
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-8 pt-2">
                            <div className={`p-4 border-4 border-black dark:border-white ${plan.featured ? "neobrutal-bg-yellow" : "neobrutal-bg-cyan"}`}>
                                {getIcon(plan.name)}
                            </div>
                            <div className="text-right">
                                <div className="text-3xl font-mono font-black text-black dark:text-white">${plan.price}</div>
                                <div className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mt-1">
                                    {plan.period === 'forever' ? 'forever' : `/${plan.period || 'month'}`}
                                </div>
                            </div>
                        </div>

                        <h2 className="text-2xl font-black text-black dark:text-white mb-2">{plan.name}</h2>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 font-bold mb-8">{plan.desc}</p>

                        <ul className="space-y-4 flex-1 mb-10 border-t-4 border-black dark:border-white pt-6">
                            {(Array.isArray(plan.features) ? plan.features : Object.keys(plan.features)).map((feat, j) => (
                                <li key={j} className="flex items-start gap-3 text-sm text-zinc-850 dark:text-zinc-200 font-bold">
                                    <div className={`mt-0.5 p-0.5 border-2 border-black ${plan.featured ? "bg-amber-300 text-black" : "bg-cyan-300 text-black"}`}>
                                        <Check className="w-3.5 h-3.5" />
                                    </div>
                                    <span>{typeof feat === 'string' ? feat : String(feat)}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            onClick={() => handlePlanSelect(plan)}
                            className={`
                                w-full py-4 border-4 border-black font-black uppercase tracking-[0.2em] transition-all cursor-pointer
                                hover:translate-x-[-2px] hover:translate-y-[-2px]
                                ${plan.featured
                                    ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                                    : "bg-black hover:bg-zinc-800 text-white hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                                }
                                ${subscription?.plan_id === plan.name ? "opacity-35 cursor-default hover:translate-x-0 hover:translate-y-0 hover:shadow-none" : ""}
                            `}
                        >
                            {subscription?.plan_id === plan.name ? "Current Plan" : (plan.button_text || "Choose Plan")}
                        </button>
                    </div>
                ))}
            </div>

            {/* Security section */}
            <section className="mt-10 border-4 border-black dark:border-white bg-[#4ade80] text-black p-8 sm:p-12 text-center space-y-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer">
                <div className="flex justify-center">
                    <div className="w-14 h-14 border-4 border-black neobrutal-bg-yellow flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                        <Shield className="w-8 h-8 text-black" />
                    </div>
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight">Secure & Trusted</h2>
                <p className="max-w-xl mx-auto text-sm sm:text-base font-extrabold leading-relaxed text-black">
                    We use industry-standard encryption and security protocols to ensure your data and payments are always safe. No hidden fees, cancel anytime.
                </p>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] pt-4">
                    Payments are not wired yet. This dashboard reflects stored plans and subscriptions.
                </p>
            </section>

            {/* Payment Modal */}
            {showModal && selectedPlan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 border-4 border-black dark:border-white p-8 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] dark:shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] flex flex-col max-h-[90vh] overflow-y-auto">
                        <button 
                            onClick={() => {
                                setShowModal(false);
                                setIframeUrl(null);
                            }}
                            className="absolute top-6 right-6 p-2 border-2 border-black bg-red-500 hover:bg-red-650 text-white transition-all cursor-pointer"
                        >
                            <X className="w-4 h-4 text-white font-black" />
                        </button>

                        {!iframeUrl ? (
                            <div className="space-y-6 pt-4">
                                <div>
                                    <h3 className="text-2xl font-black text-black dark:text-white uppercase italic">Complete Subscription</h3>
                                    <p className="text-zinc-650 dark:text-zinc-400 text-xs font-bold mt-1">
                                        Plan: <span className="text-indigo-650 dark:text-indigo-400 font-black uppercase">{selectedPlan.name}</span> — Price: <span className="text-black dark:text-white font-mono font-black">${selectedPlan.price}/month</span>
                                    </p>
                                </div>

                                <form onSubmit={handleStartPayment} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">First Name</label>
                                            <input 
                                                type="text" 
                                                required
                                                value={firstName}
                                                onChange={e => setFirstName(e.target.value)}
                                                placeholder="e.g. Ahmad"
                                                className="w-full h-12 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 text-sm text-black dark:text-white outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Last Name</label>
                                            <input 
                                                type="text" 
                                                required
                                                value={lastName}
                                                onChange={e => setLastName(e.target.value)}
                                                placeholder="e.g. Ali"
                                                className="w-full h-12 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 text-sm text-black dark:text-white outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Phone Number</label>
                                        <input 
                                            type="tel" 
                                            required
                                            value={phoneNumber}
                                            onChange={e => setPhoneNumber(e.target.value)}
                                            placeholder="e.g. +2010xxxxxxxx"
                                            className="w-full h-12 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 text-sm text-black dark:text-white outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Email Address</label>
                                        <input 
                                            type="email" 
                                            disabled
                                            value={user?.email || ""}
                                            className="w-full h-12 border-4 border-black/20 dark:border-white/20 bg-zinc-100 dark:bg-zinc-900 px-4 text-sm text-zinc-500 cursor-not-allowed outline-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isGeneratingCheckout}
                                        className="w-full h-14 border-4 border-black bg-[#fb923c] hover:bg-amber-500 text-black font-black uppercase tracking-widest hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-2"
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
                            <div className="space-y-6 flex-1 flex flex-col pt-4">
                                <div>
                                    <h3 className="text-xl font-black text-black dark:text-white uppercase italic">Paymob Secure Checkout</h3>
                                    <p className="text-zinc-500 dark:text-zinc-400 text-xs font-bold mt-1">Complete your payment details inside the secure frame below.</p>
                                </div>
                                <div className="relative border-4 border-black bg-zinc-900 flex-1 min-h-[500px]">
                                    <iframe 
                                        src={iframeUrl} 
                                        className="absolute inset-0 w-full h-full border-0" 
                                        allow="payment"
                                    />
                                </div>
                                <div className="text-center text-[10px] text-zinc-550 dark:text-zinc-400 font-black uppercase tracking-wider">
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
