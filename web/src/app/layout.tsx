import "./globals.css";
import type { ReactNode } from "react";
import Providers from "@/app/providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "EGX Bots",
  description: "Advanced AI-driven stock analysis platform. Combining RandomForest models with multi-source fundamentals to give you the edge.",
  manifest: "/favicon_io/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon_io/favicon-16x16.png?v=2", sizes: "16x16", type: "image/png" },
      { url: "/favicon_io/favicon-32x32.png?v=2", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon_io/favicon.ico?v=2",
    apple: "/favicon_io/apple-touch-icon.png?v=2",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <body className="bg-zinc-950 text-zinc-50 antialiased selection:bg-blue-500/30">
        <Providers>
          <Header />
          <main id="main-content" className="w-full pb-12 px-3 sm:px-6 md:px-8 mx-auto max-w-[1800px]">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
