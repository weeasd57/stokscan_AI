import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "إنشاء حساب جديد | Sign Up",
    description: "أنشئ حساباً جديداً في EGX BOTS وابدأ تحليل الأسهم بالذكاء الاصطناعي.",
    robots: {
        index: false,
        follow: false,
    },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
