import LegalStatusClient from "./LegalStatusClient";

export const metadata = {
  title: "الموقف القانوني والتنظيمي والامتثال",
  description:
    "توضيح الموقف القانوني والتنظيمي لمنصة EGX Bots وامتثالها للقوانين والتشريعات المصرية وقانون سوق رأس المال 95 لسنة 1992 وقواعد الرقابة المالية.",
  keywords: [
    "الموقف القانوني",
    "الرقابة المالية",
    "قانون سوق رأس المال",
    "البورصة المصرية",
    "ترخيص الاستشارات المالية",
    "إخلاء المسؤولية",
    "EGX Bots",
  ],
  alternates: {
    canonical: "https://egxbots.com/legal-status",
  },
  openGraph: {
    title: "الموقف القانوني والتنظيمي | EGX Bots",
    description:
      "توضيح طبيعة منصة EGX Bots البرمجية وامتثالها للقوانين المصرية وقواعد سوق رأس المال.",
    url: "https://egxbots.com/legal-status",
    type: "website",
    locale: "ar_EG",
  },
  twitter: {
    card: "summary_large_image",
    title: "Legal & Regulatory Status | EGX Bots",
    description: "Clarification of EGX Bots legal and regulatory status under Egyptian law.",
  },
};

export default function LegalStatusPage() {
  return <LegalStatusClient />;
}
