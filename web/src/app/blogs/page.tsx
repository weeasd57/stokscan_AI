import { Metadata } from "next";
import BlogsClient from "./BlogsClient";

export const metadata: Metadata = {
  title: "مدونة وتحليلات البورصة المصرية بالذكاء الاصطناعي | EGX Bots Market Blog",
  description: "مقالات وتحليلات معمقة لحركة الأسهم في البورصة المصرية (EGX)، مؤشرات التحليل الفني، نماذج الذكاء الاصطناعي والتعلم الآلي، وتطورات التداول المالي في السوق المصري.",
  keywords: [
    "تحليلات البورصة المصرية",
    "مدونة البورصة المصرية",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "توقعات البورصة المصرية",
    "EGX BOTS Blog",
    "EGX",
    "البورصة المصرية"
  ],
  alternates: {
    canonical: "https://egxbots.com/blogs",
  },
  openGraph: {
    title: "مدونة وتحليلات البورصة المصرية بالذكاء الاصطناعي | EGX Bots",
    description: "مقالات وتحليلات معمقة لحركة الأسهم في البورصة المصرية ومؤشرات التداول الكمي بالذكاء الاصطناعي.",
    url: "https://egxbots.com/blogs",
    type: "website",
  },
};

export default function BlogsPage() {
  return <BlogsClient />;
}
