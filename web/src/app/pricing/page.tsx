import PricingClient from "./PricingClient";

export const metadata = {
  title: "خطط الأسعار والاشتراكات الشهرية والسنوية",
  description:
    "خطط الأسعار المتاحة لمنصة EGX Bots. اشترك في خطة Pro للحصول على إشارات يومية ومزايا كاملة.",
  keywords: ["الأسعار", "الاشتراكات", "خطة", "EGX Bots", "الاشتراك المدفوع"],
  alternates: { canonical: "https://egxbots.com/pricing" },
};

export default function PricingPage() {
  return <PricingClient />;
}
