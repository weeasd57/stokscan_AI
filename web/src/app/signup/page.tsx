"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

export default function SignupPage() {
  const router = useRouter();
  const { signUp, user, loading } = useAuth();
  const { t } = useLanguage();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => email.trim().length > 3 && password.length >= 6 && !submitting, [email, password, submitting]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await signUp(email.trim(), password);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/login");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && user) {
    router.replace("/profile");
    return null;
  }

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden neobrutal-grid-bg">
      <div className="w-full max-w-md neobrutal-card p-8 relative z-10">
        <h1 className="text-3xl font-black text-black dark:text-white tracking-tight">{t("auth.signup.title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 font-semibold">{t("auth.signup.subtitle")}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-wider text-black dark:text-white">{t("auth.email")}</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="h-11 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 text-sm text-black dark:text-white outline-none transition-all focus:bg-yellow-50 dark:focus:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
              placeholder={t("auth.email_placeholder")}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-wider text-black dark:text-white">{t("auth.password")}</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              className="h-11 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 text-sm text-black dark:text-white outline-none transition-all focus:bg-yellow-50 dark:focus:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
              placeholder={t("auth.password_placeholder")}
              required
            />
          </div>

          {error && <div className="border-4 border-black dark:border-white bg-red-100 dark:bg-red-950 p-3.5 text-xs text-red-700 dark:text-red-300 font-bold leading-relaxed">{error}</div>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="neobrutal-btn neobrutal-bg-yellow font-black text-sm text-black h-11 w-full flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
          >
            {submitting ? t("auth.creating_btn") : t("auth.create_btn")}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-zinc-500 font-bold">
          {t("auth.signup.have_account")}{" "}
          <Link href="/login" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            {t("auth.signup.login")}
          </Link>
        </div>
      </div>
    </div>
  );
}
