import ComparisonClient from "./ComparisonClient";

export const metadata = {
  title: "Stock Comparison Scanner | EGX Bots",
  description: "Compare multiple Egyptian Stock Exchange (EGX) symbols side-by-side. Analyze technical indicators, average win rates, and AI-predicted signals simultaneously.",
};

export default function ComparisonPage() {
  return <ComparisonClient />;
}
