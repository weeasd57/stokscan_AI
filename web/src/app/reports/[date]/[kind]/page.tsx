import Link from 'next/link';
import { notFound } from 'next/navigation';
import BrandedPageHeader from '@/components/BrandedPageHeader';
import { getPublicReports, reportNames, reportUrl, type PublicReport } from '@/lib/social/public-reports';

export const revalidate = 86400;
// Generate on first request, then serve the entire HTML route from ISR.
export async function generateStaticParams() { return []; }
type Props = { params: Promise<{ date: string; kind: string }> };
async function load(params: Props['params']) {
  const { date, kind } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['market', 'accumulation'].includes(kind)) notFound();
  const report = (await getPublicReports()).find(r => r.session_date === date && r.kind === kind);
  if (!report) notFound();
  return report;
}
export async function generateMetadata({ params }: Props) {
  const r = await load(params);
  return { title: `${reportNames[r.kind]} — جلسة ${r.session_date}`, description: `تقرير EGX BOTS لجلسة ${r.session_date} مع بيانات المصدر وحدود التحليل.`,
    alternates: { canonical: `https://egxbots.com${reportUrl(r)}` } };
}
const value = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : 'غير متاح';
function Evidence({ report: r }: { report: PublicReport }) {
  const e = r.evidence.find(e => e.tool === (r.kind === 'market' ? 'get_market' : 'get_accumulation_stocks'));
  const d = e?.data;
  if (!d) return <p>تفاصيل الأرقام غير متاحة لهذا التقرير.</p>;
  return <div className="overflow-x-auto">
    <p className="mb-4 text-sm leading-7">المصدر: بيانات EGX BOTS المحفوظة وقت إعداد التقرير. {r.kind === 'accumulation' ? 'عينة الأسهم مرتفعة السيولة؛ لا تمثل السوق كله.' : 'إغلاقات مسجلة؛ تاريخ كل مكوّن موضح بالجدول.'}</p>
    <table className="w-full text-right text-sm"><thead className="bg-amber-300 text-slate-950"><tr>{(r.kind === 'market' ? ['المؤشر', 'القيمة', 'تاريخ البيانات'] : ['السهم', 'درجة التجميع', 'الحجم النسبي', 'جلسات الاستمرار']).map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead>
      <tbody>{r.kind === 'market' ? ['egx30', 'egx100', 'usd'].map(k => <tr key={k} className="border-b border-zinc-200 dark:border-slate-700"><td className="p-3">{k === 'usd' ? 'USD/EGP' : k.toUpperCase()}</td><td>{value(d[k])}</td><td>{d.component_dates?.[k] || 'غير متاح'}{d.component_dates?.[k] && d.component_dates[k] !== r.session_date ? ' — مختلف عن تاريخ الجلسة' : ''}</td></tr>) : (Array.isArray(d.stocks) ? d.stocks : []).map((s: any) => <tr key={s.symbol} className="border-b border-zinc-200 dark:border-slate-700"><td className="p-3"><Link className="underline" href={`/stocks/${encodeURIComponent(String(s.symbol).toLowerCase())}`}>{s.symbol}</Link></td><td>{value(s.acc_score)}</td><td>{value(s.vol_ratio)}×</td><td>{value(s.consecutive_acc_days)}</td></tr>)}</tbody>
    </table>
  </div>;
}
export default async function ReportPage({ params }: Props) {
  const r = await load(params);
  const title = `${reportNames[r.kind]} — جلسة ${r.session_date}`;
  const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: title,
    datePublished: r.created_at, dateModified: r.updated_at, inLanguage: 'ar',
    mainEntityOfPage: `https://egxbots.com${reportUrl(r)}`, author: { '@type': 'Organization', name: 'EGX BOTS' } };
  return <main dir="rtl" className="mx-auto max-w-5xl px-4 py-8 text-zinc-950 dark:text-white">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />
    <Link href="/reports" className="mb-5 inline-block text-sm underline">كل التقارير اليومية</Link>
    <BrandedPageHeader eyebrow="EGX BOTS RESEARCH" title={title} description="تحليل آلي تعليمي مبني على البيانات المحفوظة للجلسة؛ ليس توصية شراء أو بيع." />
    <article className="space-y-8 border border-zinc-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 sm:p-8">
      <section><h2 className="mb-4 text-xl font-bold">التحليل</h2><div className="whitespace-pre-wrap break-words leading-8">{r.content}</div></section>
      <section id="sources"><h2 className="mb-4 text-xl font-bold">الأرقام المسجلة ومصادرها</h2><Evidence report={r} /></section>
      <section id="methodology" className="border-t border-zinc-200 pt-6 text-sm leading-8 dark:border-slate-700"><h2 className="text-xl font-bold">المنهجية وحدود القراءة</h2>
        <p>أُعدّ التقرير بعد اكتمال مزامنة الأسعار وحساب المؤشرات اليومية. الأرقام أعلاه مأخوذة من الأدلة المحفوظة مع التقرير، وقد تختلف عن بيانات جلسات لاحقة.</p>
        <p>الحجم النسبي يقارن حجم التداول بمتوسطه المرجعي في السكانر. درجة التجميع تقييم خوارزمي وليست إثباتًا لهوية المشترين أو احتمال ربح. الاستمرار هو عدد جلسات الإشارة المسجل في المصدر.</p>
        <p>لا نستنتج نسبة تغطية السوق أو تغيّرها من عينة محدودة، ولا ننشئ مقارنة بجلسة سابقة دون بيانات متجانسة محفوظة.</p>
        <Link className="underline" href={r.kind === 'market' ? '/scanner/market' : '/scanner/technical'}>فتح أداة التحليل</Link>
      </section>
    </article>
  </main>;
}
