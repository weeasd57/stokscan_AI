import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "تسجيل الدخول | Login",
    description: "تسجيل الدخول إلى منصة EGX BOTS لمتابعة تحليلات البورصة المصرية.",
    robots: {
        index: false,
        follow: false,
    },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
