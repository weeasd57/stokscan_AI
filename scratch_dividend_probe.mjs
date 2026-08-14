// Quick probe: compare DDG result quality for dividend queries with/without region hint
import { searchWeb } from "./web/src/lib/ai/web-search.ts";

const queries = [
    "توزيعات ارباح الاسهم البورصة المصرية الشهر القادم",
    "توزيعات ارباح الاسهم البورصة المصرية شهر سبتمبر",
    "أرباح الأسهم البورصة المصرية egx dividend",
];

for (const q of queries) {
    const results = await searchWeb(q, 4);
    console.log(`\n=== ${q} => ${results.length} results`);
    results.forEach((r, i) => console.log(`  ${i + 1}. [${r.domain}] ${r.title}`));
}
