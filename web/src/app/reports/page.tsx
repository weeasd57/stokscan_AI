import Link from 'next/link';
import BrandedPageHeader from '@/components/BrandedPageHeader';
import { getPublicReports, reportNames, reportUrl } from '@/lib/social/public-reports';

export const revalidate = 86400;
export const metadata = {
  title: 'تقارير السوق والتجميع اليومية',
  description: 'أرشيف تقارير EGX BOTS المؤرخة مع مصادر الأرقام ونطاق التغطية والمنهجية.',
  alternates: { canonical: 'https://egxbots.com/reports' },
};

export default async function ReportsPage() {
  const reports = await getPublicReports();
  return <main dir="rtl" className="mx-auto max-w-6xl px-4 py-8 text-zinc-950 dark:text-white">
    <BrandedPageHeader eyebrow="EGX BOTS RESEARCH" title="تقارير السوق والتجميع" description="تحليلات يومية مؤرخة من بيانات الجلسات المكتملة، مع الأرقام والمصادر وحدود التغطية." />
    <div className="grid gap-5 sm:grid-cols-2">
      {reports.map(r => <Link key={reportUrl(r)} href={reportUrl(r)} className="border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-amber-400 dark:border-slate-700 dark:bg-slate-900">
        <time dateTime={r.session_date} className="text-sm text-zinc-500 dark:text-slate-400">جلسة {r.session_date}</time>
        <h2 className="mt-3 text-xl font-bold">{reportNames[r.kind]}</h2>
        <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-slate-300">قراءة التقرير والأرقام المسجلة ومنهجية التحليل ←</p>
      </Link>)}
    </div>
    {!reports.length && <p className="py-12">لم تتوفر تقارير معتمدة للنشر بعد.</p>}
  </main>;
}
