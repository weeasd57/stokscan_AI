"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle, user, loading } = useAuth();
  const { t } = useLanguage();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const canSubmit = useMemo(() => email.trim().length > 3 && password.length >= 6 && !submitting, [email, password, submitting]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await signIn(email.trim(), password);
      if (res.error) {
        setError(res.error);
        return;
      }
      const isAdmin = res.user?.app_metadata?.role === "admin" || res.user?.email === "weeeessd57@gmail.com";
      router.push(isAdmin ? "/admin" : "/scanner/technical");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle();
      if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setGoogleLoading(false);
    }
  }

  if (!loading && user) {
    const isAdmin = user.app_metadata?.role === "admin" || user.email === "weeeessd57@gmail.com";
    router.replace(isAdmin ? "/admin" : "/scanner/technical");
    return null;
  }

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden neobrutal-grid-bg">
      <div className="w-full max-w-md neobrutal-card p-8 relative z-10">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-black dark:text-white tracking-tight">
            {t("auth.login.title")}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 font-semibold">{t("auth.login.subtitle")}</p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
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
            <div className="relative">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 pr-11 text-sm text-black dark:text-white outline-none transition-all focus:bg-yellow-50 dark:focus:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
              </button>
            </div>
          </div>

          {error && <div className="border-4 border-black dark:border-white bg-red-100 dark:bg-red-950 p-3.5 text-xs text-red-700 dark:text-red-300 font-bold leading-relaxed">{error}</div>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="neobrutal-btn neobrutal-bg-yellow font-black text-sm text-black h-11 w-full flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
          >
            {submitting ? t("auth.signingin_btn") : t("auth.signin_btn")}
          </button>
        </form>

        <div className="relative my-6 select-none">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t-2 border-black dark:border-white"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
            <span className="bg-white dark:bg-zinc-900 px-3 text-black dark:text-white font-black">{t("auth.or")}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={googleLoading || submitting}
          onClick={handleGoogleSignIn}
          className="neobrutal-btn bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-sm h-11 w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {googleLoading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent mr-2" />
          ) : (
            <svg className="mr-3 h-4 w-4 shrink-0" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
          )}
          {googleLoading ? t("auth.signingin_btn") : t("auth.signin_google")}
        </button>

        <div className="mt-6 text-center text-xs text-zinc-500 font-bold">
          {t("auth.login.no_account")}{" "}
          <Link href="/signup" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            {t("auth.login.create_one")}
          </Link>
        </div>
      </div>
    </div>
  );
}
