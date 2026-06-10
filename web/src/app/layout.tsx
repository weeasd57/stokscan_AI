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
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
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
          <main id="main-content" className="app-content-shell w-full pt-[96px] pb-12 px-3 sm:px-6 md:px-8 mx-auto max-w-[1800px]">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
