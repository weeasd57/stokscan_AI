import RefundClient from "./RefundClient";

export const metadata = {
  title: "سياسة الاسترجاع | EGX Bots - تحليل البورصة المصرية",
  description:
    "سياسة الاسترجاع واسترداد الأموال لاشتراكات منصة EGX Bots وكيفية طلب استرداد.",
  keywords: ["سياسة الاسترجاع", "استرداد", "الاشتراكات", "EGX Bots"],
  alternates: { canonical: "https://egxbots.com/refund" },
};

export default function RefundPage() {
  return <RefundClient />;
}
