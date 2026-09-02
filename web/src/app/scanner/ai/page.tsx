import { Metadata } from "next";
import AIScannerClient from "./AIScannerClient";

export const metadata: Metadata = {
  title: "محلل الأسهم المصرية بالذكاء الاصطناعي | EGX AI Analyzer | EGX BOTS",
  description: "أقوى محلل لأسهم البورصة المصرية بالذكاء الاصطناعي (EGX AI Analyzer). تقييم فوري 1-10، فحص فني ومالي، كشف السيولة ونقاط الدعم والمقاومة، وشات بوت تفاعلي مباشر للسوق المصري.",
  keywords: [
    "EGX AI Analyzer",
    "egx ai analyzer",
    "محلل الأسهم المصرية بالذكاء الاصطناعي",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "ذكاء اصطناعي للبورصة",
    "توقعات البورصة المصرية",
    "ماسح الأسهم المصرية",
    "EGX BOTS",
    "egxbots",
    "egx bot",
    "توصيات البورصة المصرية",
    "شات بوت البورصة"
  ],
  alternates: {
    canonical: "https://egxbots.com/scanner/ai",
  },
  openGraph: {
    title: "محلل الأسهم المصرية بالذكاء الاصطناعي | EGX AI Analyzer | EGX BOTS",
    description: "أقوى محلل لأسهم البورصة المصرية بالذكاء الاصطناعي (EGX AI Analyzer). تقييمات كمية 1-10، فحص فني مباشر، وشات بوت تفاعلي للسوق المصري.",
    type: "website",
    url: "https://egxbots.com/scanner/ai",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX AI Analyzer Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "محلل الأسهم المصرية بالذكاء الاصطناعي | EGX AI Analyzer",
    description: "AI-driven stock analysis for the Egyptian Exchange (EGX). Real-time scores from 1 to 10, backtested algorithms, and interactive AI chatbot.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const aiStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://egxbots.com/scanner/ai#software",
      "name": "EGX AI Analyzer",
      "alternateName": "محلل الأسهم المصرية بالذكاء الاصطناعي",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Web",
      "description": "نظام تحليل كمي ذكي لأسهم البورصة المصرية يمنح تقييمات دقيقة من 1 إلى 10 ومحاكاة تاريخية وتفاعل مباشر عبر شات بوت ذكي.",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "EGP"
      }
    },
    {
      "@type": "FAQPage",
      "@id": "https://egxbots.com/scanner/ai#faq",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "كيف يعمل محلل الأسهم بالذكاء الاصطناعي (EGX AI Analyzer)؟",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "يعتمد المحلل على نماذج تعلم آلي كمية تم تدريبها على سنوات من بيانات التداول التاريخية في البورصة المصرية EGX لحساب تقييم رقمي موضوعي لكل سهم دون تحيز بشري."
          }
        },
        {
          "@type": "Question",
          "name": "ما هو مقياس الذكاء الاصطناعي (AI Score) من 1 إلى 10؟",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "المقياس هو تصنيف احتمالي لحركة السهم: من 1 إلى 3 يشير إلى البيع أو التخفيف، ومن 4 إلى 6 يشير إلى الاتجاه المحايد أو الاحتفاظ، ومن 7 إلى 10 يشير إلى فرص شراء ذات احتمالية إيجابية مرتفعة."
          }
        },
        {
          "@type": "Question",
          "name": "هل يمكن مناقشة المحلل الذكي في تفاصيل الأسهم؟",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "نعم، توفر المنصة شات بوت تفاعلي مباشر يمكنك التحدث معه بالعربية أو الإنجليزية، والسؤال عن أي سهم مصري ورفع صور الشارت ومحفظتك لتحليلها فوراً."
          }
        }
      ]
    }
  ]
};

export default function AIScannerPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aiStructuredData) }}
      />
      <AIScannerClient />
    </>
  );
}
