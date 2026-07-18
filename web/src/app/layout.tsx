import "./globals.css";
import type { ReactNode } from "react";
import Providers from "@/app/providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SupportChatWidget from "@/components/SupportChatWidget";
import { Analytics } from "@vercel/analytics/react";

export const metadata = {
  metadataBase: new URL('https://egxbots.com'),
  alternates: {
    canonical: 'https://egxbots.com',
  },
  title: {
    default: "EGX BOTS | تحليل البورصة المصرية بالذكاء الاصطناعي",
    template: "%s | EGX BOTS"
  },
  description: "منصة EGX BOTS (egxbots) هي منصة متقدمة لتحليل الأسهم المصرية باستخدام الذكاء الاصطناعي، الماسح الفني، والمحاكاة التاريخية وإشارات السوق.",
  keywords: ["EGX BOTS", "egxbots", "egx bots", "إي جي إكس بوتس", "البورصة المصرية", "EGX", "ذكاء اصطناعي", "تحليل أسهم", "تداول آلي", "إشارات تداول"],
  authors: [{ name: "EGX BOTS Team" }],
  creator: "EGX BOTS",
  openGraph: {
    type: "website",
    locale: "ar_EG",
    url: "https://egxbots.com",
    title: "EGX BOTS | تحليل البورصة المصرية بالذكاء الاصطناعي",
    description: "منصة EGX BOTS (egxbots) لتحليل الأسهم المصرية بالذكاء الاصطناعي والماسح الفني والمحاكاة التاريخية.",
    siteName: "EGX BOTS",
    images: [
      {
        url: "/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX BOTS Dashboard Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "EGX BOTS | AI Stock Analysis",
    description: "AI-driven stock analysis platform for EGX with technical scanning and backtests.",
    images: ["/dashboard_preview.png"],
  },
  manifest: "/favicon_io/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon_io/favicon.ico", type: "image/x-icon" },
      { url: "/favicon_io/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon_io/favicon-16x16.png", type: "image/png", sizes: "16x16" }
    ],
    shortcut: "/favicon_io/favicon.ico",
    apple: "/favicon_io/apple-touch-icon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ar" dir="ltr" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "FinancialService",
                  "@id": "https://egxbots.com/#financial-service",
                  "name": "EGX BOTS",
                  "url": "https://egxbots.com",
                  "logo": "https://egxbots.com/favicon_io/android-chrome-512x512.png",
                  "image": "https://egxbots.com/dashboard_preview.png",
                  "description": "منصة EGX BOTS (egxbots) هي منصة متقدمة لتحليل الأسهم المصرية بالذكاء الاصطناعي والماسح الفني والمحاكاة التاريخية وإشارات السوق اليومية.",
                  "sameAs": [
                    "https://t.me/egxbots"
                  ],
                  "address": {
                    "@type": "PostalAddress",
                    "addressCountry": "EG"
                  }
                },
                {
                  "@type": "SoftwareApplication",
                  "@id": "https://egxbots.com/#software-application",
                  "name": "EGX BOTS",
                  "operatingSystem": "Web",
                  "applicationCategory": "FinanceApplication",
                  "description": "EGX BOTS (egxbots) is an advanced AI-driven stock analysis platform for the Egyptian Exchange (EGX).",
                  "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "EGP"
                  },
                  "author": {
                    "@type": "Organization",
                    "name": "EGX BOTS"
                  }
                }
              ]
            })
          }}
        />
        {/* Script to prevent FOUC (Flash of Unstyled Content) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem('theme');
                  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                  const theme = saved || preferred;
                  
                  if (theme === 'light') {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.classList.add('light');
                  } else {
                    document.documentElement.classList.remove('light');
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="app-shell antialiased selection:dark:bg-blue-500/30 selection:light:bg-blue-300/30">
        <Providers>
          <Header />
          <main id="main-content" className="app-content-shell w-full pt-[var(--header-offset,88px)] pb-12 px-3 sm:px-6 md:px-8 mx-auto max-w-[1800px]">
            {children}
          </main>
          <Footer />
          <SupportChatWidget />
          <Analytics />
        </Providers>
      </body>
    </html>
  );
}
