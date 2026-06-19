import ComparisonClient from "./ComparisonClient";

export const metadata = {
  title: "Stock Comparison Scanner | EGX Bots",
  description: "Compare multiple Egyptian Stock Exchange (EGX) symbols side-by-side and review technical indicators and performance statistics.",
};

export default function ComparisonPage() {
  return <ComparisonClient />;
}
