"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { WatchlistProvider } from "@/contexts/WatchlistContext";
import { AppStateProvider } from "@/contexts/AppStateContext";
import { AIScannerProvider } from "@/contexts/AIScannerContext";
import { TechnicalScannerProvider } from "@/contexts/TechnicalScannerContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SupportChatProvider } from "@/contexts/SupportChatContext";

if (typeof window !== "undefined") {
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    let url = "";
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input && typeof input === "object" && "url" in input) {
      url = (input as any).url || "";
    }

    if (
      url.includes("ngrok-free.app") ||
      url.startsWith("/") ||
      url.includes("/api/") ||
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1")
    ) {
      const newInit = { ...init };
      const headers = new Headers(newInit.headers || {});
      headers.set("ngrok-skip-browser-warning", "true");
      newInit.headers = headers;

      if (input instanceof Request) {
        const clonedRequest = new Request(input, {
          headers: newInit.headers,
        });
        return originalFetch(clonedRequest, newInit);
      }

      return originalFetch(input, newInit);
    }
    return originalFetch(input, init);
  };
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SupportChatProvider>
          <LanguageProvider>
            <NotificationProvider>
              <WatchlistProvider>
                <AppStateProvider>
                  <TechnicalScannerProvider>
                    <AIScannerProvider>
                      {children}
                    </AIScannerProvider>
                  </TechnicalScannerProvider>
                </AppStateProvider>
              </WatchlistProvider>
            </NotificationProvider>
          </LanguageProvider>
        </SupportChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
