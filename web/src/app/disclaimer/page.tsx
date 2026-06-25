import DisclaimerClient from "./DisclaimerClient";

export const metadata = {
  title: "إخلاء المسؤولية القانونية | EGX Bots - تحليل البورصة المصرية",
  description:
    "الشروط القانونية والتحذيرات وإخلاء المسؤولية القانونية لاستخدام منصة EGX Bots ونماذج الذكاء الاصطناعي وإشارات التداول الخاصة بالبورصة المصرية.",
  keywords: [
    "إخلاء المسؤولية",
    "تحذير المخاطر",
    "الشروط القانونية",
    "البورصة المصرية",
    "تحليل الأسهم",
    "تداول",
    "EGX Bots",
  ],
  alternates: {
    canonical: "https://egxbots.com/disclaimer",
  },
  openGraph: {
    title: "إخلاء المسؤولية القانونية | EGX Bots",
    description:
      "الشروط القانونية والتحذيرات وإخلاء المسؤولية القانونية لاستخدام منصة EGX Bots ونماذج الذكاء الاصطناعي.",
    url: "https://egxbots.com/disclaimer",
    type: "website",
    locale: "ar_EG",
  },
  twitter: {
    card: "summary_large_image",
    title: "Disclaimer & Legal Warning | EGX Bots",
    description: "Legal terms, risk warnings, and disclaimers for using the EGX Bots AI trading analysis platform.",
  },
};

export default function DisclaimerPage() {
  return <DisclaimerClient />;
}
