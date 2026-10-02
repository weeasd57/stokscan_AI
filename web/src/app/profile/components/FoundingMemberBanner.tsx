"use client";

import { useState, useEffect } from "react";
import { X, Award } from "lucide-react";

interface Props {
  memberNumber?: number | null;
  language?: string;
}

export default function FoundingMemberBanner({ memberNumber, language = "ar" }: Props) {
  const isAr = language === "ar";
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const isDismissed = localStorage.getItem("founding_banner_dismissed");
      if (!isDismissed) {
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem("founding_banner_dismissed", "true");
    } catch {}
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div 
      dir={isAr ? "rtl" : "ltr"}
      className="w-full h-[40px] bg-gradient-to-r from-amber-400 via-[#FFE600] to-yellow-400 border-b-2 sm:border-2 border-black text-black px-3 sm:px-4 shadow-[0_2px_0_0_#000] flex items-center justify-between z-30 transition-all select-none"
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="shrink-0 flex items-center justify-center w-6 h-6 bg-black text-[#FFE600] border border-black shadow-[1px_1px_0_0_#000] rotate-[-3deg]">
          <Award className="w-3.5 h-3.5" />
        </span>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-black truncate">
          <span className="px-1.5 py-0.5 bg-black text-[#FFE600] text-[9px] uppercase tracking-wider font-black">
            FOUNDER VIP
          </span>
          <span className="truncate">
            {isAr ? (
              <>
                <span className="hidden sm:inline">
                  تهانينا! أنت ضمن <strong>أول 100 مؤسس لـ EGX Bots</strong> {memberNumber != null ? `(#${memberNumber})` : ""} — اشتراكك مثبت بـ <strong>50 ج.م فقط مدى الحياة</strong>.
                </span>
                <span className="inline sm:hidden">
                  أنت مؤسس {memberNumber != null ? `(#${memberNumber})` : ""} — مثبت بـ <strong>50 ج.م مدى الحياة ⭐</strong>
                </span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">
                  Congratulations! You are a <strong>Founding Member</strong> {memberNumber != null ? `(#${memberNumber})` : ""} — locked at <strong>50 EGP/mo for life</strong>.
                </span>
                <span className="inline sm:hidden">
                  Founding Member {memberNumber != null ? `(#${memberNumber})` : ""} — locked at <strong>50 EGP/mo ⭐</strong>
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ms-2">
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 hover:bg-black/10 active:bg-black/20 border border-black/40 hover:border-black transition-all cursor-pointer"
          title={isAr ? "إغلاق الإشعار" : "Dismiss"}
          aria-label="Dismiss banner"
        >
          <X className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}
