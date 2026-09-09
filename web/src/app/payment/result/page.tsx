import { Suspense } from "react";
import PaymentResultClient from "./PaymentResultClient";

export const metadata = {
  title: "نتيجة الدفع | EGX Bots",
  description: "تأكيد حالة اشتراكك على منصة EGX Bots.",
};

export default function PaymentResultPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <PaymentResultClient />
    </Suspense>
  );
}
