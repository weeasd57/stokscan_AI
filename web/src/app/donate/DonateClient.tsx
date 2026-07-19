"use client";

import { useState } from "react";
import { Heart, Loader2, CreditCard, Coffee, Smartphone, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

interface DonationAmount {
    id: string;
    amount: number;
    label: string;
    icon: React.ReactNode;
}

const DONATION_AMOUNTS: DonationAmount[] = [
    { id: "donate_50", amount: 50, label: "فنجان قهوة (50 ج.م)", icon: <Coffee className="w-5 h-5" /> },
    { id: "donate_150", amount: 150, label: "دعم المطور (150 ج.م)", icon: <Heart className="w-5 h-5" /> },
    { id: "donate_500", amount: 500, label: "مساهمة في السيرفر (500 ج.م)", icon: <Smartphone className="w-5 h-5" /> },
];

export default function DonateClient() {
    const { t, language } = useLanguage();
    const { user } = useAuth();
    
    // Paymob Checkout States
    const [showModal, setShowModal] = useState(false);
    const [selectedAmount, setSelectedAmount] = useState<DonationAmount | null>(null);
    const [firstName, setFirstName] = useState("فاعل");
    const [lastName, setLastName] = useState("خير");
    const [phoneNumber, setPhoneNumber] = useState("01010101010");
    const [isGeneratingCheckout, setIsGeneratingCheckout] = useState(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const handleAmountSelect = (amount: DonationAmount) => {
        setSelectedAmount(amount);
        setShowModal(true);
    };

    const handleStartPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAmount) return;

        setIsGeneratingCheckout(true);
        try {
            const res = await fetch("/api/payment/paymob/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    plan_id: selectedAmount.id,
                    user_id: user?.id || "anonymous_donor",
                    email: user?.email || "donor@egxbots.com",
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
                    alert(language === "ar" ? "سيتم تحويلك لصفحة الدفع... بعد إتمام الدفع يمكنك إغلاق النافذة" : "Redirecting to payment... Please complete payment in the new window.");
                    setShowModal(false);
                } else {
                    setIframeUrl(data.url);
                }
            } else {
                throw new Error("No checkout URL returned from server");
            }
        } catch (err: any) {
            alert(err.message || "حدث خطأ أثناء تهيئة عملية الدفع");
        } finally {
            setIsGeneratingCheckout(false);
        }
    };

    return (
        <div className="neobrutal-layout flex flex-col gap-16 pb-20 max-w-[1200px] mx-auto pt-2 px-4 md:px-8 min-h-screen neobrutal-grid-bg">
            <header className="text-center space-y-4 pt-8">
                <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)] flex justify-center items-center gap-4">
                    {language === "ar" ? "ادعم" : "Support"} 
                    <span className="inline-block border-4 border-black dark:border-white px-4 py-1 neobrutal-bg-yellow text-black rotate-[-1.5deg]">EGX Bots</span>
                </h1>
                <p className="text-zinc-800 dark:text-zinc-300 max-w-2xl mx-auto text-base sm:text-lg font-bold">
                    {language === "ar" 
                        ? "المنصة حالياً مجانية بالكامل وبدون إعلانات. إذا كنت تستفيد من تحليلاتنا الذكية، يمكنك دعمنا لتغطية تكاليف السيرفرات وتطوير نماذج الذكاء الاصطناعي." 
                        : "EGX Bots is currently free and ad-free. If you find our AI insights helpful, consider supporting us to cover server costs and AI development."}
                </p>
            </header>

            <div className="max-w-2xl mx-auto w-full">
                
                {/* Paymob / Wallet Donation Options */}
                <div className="flex flex-col gap-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <CreditCard className="w-8 h-8 text-indigo-500" />
                        <h2 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white text-center">
                            {language === "ar" ? "تبرع عبر البطاقات البنكية / المحافظ" : "Donate via Cards / Wallets"}
                        </h2>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                        {DONATION_AMOUNTS.map((amt) => (
                            <button
                                key={amt.id}
                                onClick={() => handleAmountSelect(amt)}
                                className="group relative flex items-center justify-between p-4 border-4 border-black bg-zinc-50 dark:bg-zinc-900 hover:bg-[#FFE600] hover:text-black transition-all hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:border-white"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white border-2 border-black rounded-full group-hover:scale-110 transition-transform">
                                        {amt.icon}
                                    </div>
                                    <span className="font-black text-sm sm:text-base text-black dark:text-white group-hover:text-black">{amt.label}</span>
                                </div>
                                <span className="font-black text-xl text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-800">{amt.amount} EGP</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Paymob Checkout Modal */}
            {showModal && selectedAmount && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="relative w-full max-w-lg border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] animate-in zoom-in-95 duration-200">
                        <button 
                            onClick={() => { setShowModal(false); setIframeUrl(null); }}
                            className="absolute top-4 right-4 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 border-2 border-transparent hover:border-black dark:hover:border-white transition-all"
                        >
                            <X className="w-6 h-6 text-black dark:text-white" />
                        </button>
                        
                        {!iframeUrl ? (
                            <form onSubmit={handleStartPayment} className="space-y-6">
                                <div>
                                    <h3 className="text-2xl font-black text-black dark:text-white mb-2 uppercase">
                                        {language === "ar" ? "تفاصيل الدعم" : "Donation Details"}
                                    </h3>
                                    <p className="text-sm font-bold text-zinc-600 dark:text-zinc-400">
                                        {language === "ar" ? `أنت على وشك المساهمة بـ ${selectedAmount.amount} ج.م` : `You are about to donate ${selectedAmount.amount} EGP`}
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                {language === "ar" ? "الاسم الأول" : "First Name"}
                                            </label>
                                            <input 
                                                required
                                                type="text" 
                                                value={firstName}
                                                onChange={e => setFirstName(e.target.value)}
                                                className="w-full p-2.5 text-sm font-bold border-2 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white outline-none focus:bg-[#FFE600] focus:text-black transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                {language === "ar" ? "اسم العائلة" : "Last Name"}
                                            </label>
                                            <input 
                                                required
                                                type="text" 
                                                value={lastName}
                                                onChange={e => setLastName(e.target.value)}
                                                className="w-full p-2.5 text-sm font-bold border-2 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white outline-none focus:bg-[#FFE600] focus:text-black transition-colors"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                            {language === "ar" ? "رقم الموبايل المحفظة (إن وجد)" : "Wallet Mobile Number (optional)"}
                                        </label>
                                        <input 
                                            required
                                            type="tel" 
                                            value={phoneNumber}
                                            onChange={e => setPhoneNumber(e.target.value)}
                                            className="w-full p-2.5 text-sm font-bold border-2 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white outline-none focus:bg-[#FFE600] focus:text-black transition-colors font-mono"
                                        />
                                    </div>
                                </div>

                                <button 
                                    type="submit"
                                    disabled={isGeneratingCheckout}
                                    className="w-full py-4 flex items-center justify-center gap-2 border-4 border-black bg-[#00FF66] text-black font-black uppercase tracking-widest hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isGeneratingCheckout ? (
                                        <><Loader2 className="w-5 h-5 animate-spin" /> {language === "ar" ? "جاري التجهيز..." : "Processing..."}</>
                                    ) : (
                                        language === "ar" ? "متابعة الدفع الأمن" : "Proceed to Secure Payment"
                                    )}
                                </button>
                                <p className="text-[9px] text-center font-bold text-zinc-400 uppercase tracking-widest">
                                    {language === "ar" ? "المدفوعات مؤمنة بواسطة Paymob" : "Payments secured by Paymob"}
                                </p>
                            </form>
                        ) : (
                            <div className="h-[600px] w-full flex flex-col">
                                <h3 className="text-xl font-black text-black dark:text-white mb-4 uppercase shrink-0">
                                    {language === "ar" ? "الدفع الآمن" : "Secure Checkout"}
                                </h3>
                                <iframe 
                                    src={iframeUrl} 
                                    className="w-full flex-1 border-2 border-black dark:border-white bg-zinc-50"
                                    title="Paymob Checkout"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
