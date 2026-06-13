import type { ReactNode } from "react";

/**
 * Layout for /backtest — full-screen mode, no footer, no page padding.
 * The page itself handles positioning below the fixed header.
 */
export default function BacktestLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
