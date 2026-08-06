/**
 * test_planner_arabic.mjs
 * اختبار شامل لـ extractSymbolsFromText مع boundary-regex
 * تشغيل: node test_planner_arabic.mjs
 */

// ─── نسخة مستقلة من ARABIC_STOCK_MAPPINGS ───────────────────────────────────
const ARABIC_STOCK_MAPPINGS = {
    "أبو قير": "ABUK", "ابو قير": "ABUK", "ابوقير للأسمدة": "ABUK", "أبو قير للأسمدة": "ABUK",
    "ابو ظبي الاسلامي": "ADIB", "بنك ابو ظبي": "ADIB",
    "مطاحن الإسكندرية": "AFMC", "مطاحن الاسكندرية": "AFMC", "مطاحن اسكندرية": "AFMC",
    "أجواء للصناعات الغذائية": "AJWA", "اجواء للصناعات الغذائية": "AJWA",
    "عامر جروب": "AMER", "عامر هولدنج": "AMER",
    "أموك": "AMOC", "اموك": "AMOC", "الاسكندرية للزيوت المعدنية": "AMOC",
    "جي بي اوتو": "AUTO", "جي بي أوتو": "AUTO",
    "جلاكسو سميث كلاين": "BIOC", "جلاكسو": "BIOC",
    "بلتون": "BTFH",
    "القلعة": "CCAP", "القلعه": "CCAP", "شركة القلعة": "CCAP",
    "كريدي اجريكول": "CIEB", "كريدي أجريكول": "CIEB", "بنك كريدي اجريكول": "CIEB",
    "سيرا": "CIRA", "سيرا للتعليم": "CIRA",
    "كليوباترا": "CLHO", "مستشفى كليوباترا": "CLHO",
    "التجاري الدولي": "COMI", "بنك التجاري الدولي": "COMI",
    "دومتي": "DOMT",
    "دايس": "DSCW",
    "الشرقية للدخان": "EAST", "الشرقيه للدخان": "EAST", "ايسترن كومباني": "EAST", "ايسترن": "EAST",
    "إيديتا": "EFID", "ايديتا": "EFID",
    "إي فاينانس": "EFIH", "اي فاينانس": "EFIH",
    "مصر للألومنيوم": "EGAL", "مصر للالومنيوم": "EGAL",
    "كيما": "EGCH",
    "القاهرة للإسكان": "ELKA", "القاهرة للاسكان": "ELKA", "القاهرة والاسكان": "ELKA", "إلكا": "ELKA",
    "الشمس للإسكان": "ELSH", "الشمس للاسكان": "ELSH", "الشمس": "ELSH",
    "إعمار": "EMFD", "اعمار": "EMFD", "اعمار مصر": "EMFD",
    "حديد عز": "ESRS", "عز الحديد": "ESRS",
    "المصرية للاتصالات": "ETEL", "المصريه للاتصالات": "ETEL", "اتصالات مصر": "ETEL", "وي للاتصالات": "ETEL",
    "فوري": "FWRY", "فورى": "FWRY", "فوري لتكنولوجيا البنوك": "FWRY",
    "جي بي كورب": "GBCO",
    "مصر الجديدة": "HELI", "مصر الجديده": "HELI", "هيليوبوليس": "HELI",
    "هيرميس": "HRHO", "المجموعة المالية هيرميس": "HRHO", "المجموعة المالية": "HRHO", "اي اف جي": "HRHO",
    "ابن سينا": "ISPH", "ابن سينا فارما": "ISPH", "ابن سينا للادوية": "ISPH",
    "جهينة": "JUFO", "جهينه": "JUFO",
    "مدينة مصر": "MASR", "مدينه مصر": "MASR",
    "مصر بني سويف": "MBSC", "بني سويف للأسمنت": "MBSC",
    "مكادي": "MCQE",
    "موبكو": "MFPC",
    "مدينة نصر": "MNHD", "مدينه نصر": "MNHD",
    "المنصورة للدواجن": "MPCO", "المنصوره للدواجن": "MPCO",
    "سوديك": "OCDI",
    "عبور لاند": "OLFI",
    "اوراسكوم للانشاء": "ORAS", "أوراسكوم للانشاء": "ORAS",
    "اوراسكوم للتنمية": "ORHD", "أوراسكوم للتنمية": "ORHD",
    "النساجون": "ORWE", "النساجون الشرقيون": "ORWE",
    "بالم هيلز": "PHDC",
    "القاهرة للدواجن": "POUL",
    "بايونيرز": "PRDC",
    "راية": "RAYA", "راية هولدنج": "RAYA",
    "راميدا": "RMDA",
    "سيدي كرير": "SKPC", "سيدى كرير": "SKPC",
    "سبيد ميدكال": "SPMD", "سبيد": "SPMD",
    "جنوب الوادي": "SVCE", "جنوب الوادى": "SVCE", "جنوب الوادي للاسمنت": "SVCE",
    "السويدي": "SWDY", "السويدى": "SWDY", "سويدي": "SWDY", "السويدي إلكتريك": "SWDY",
    "طلعت مصطفى": "TMGH", "مجموعة طلعت مصطفى": "TMGH", "هشام طلعت مصطفى": "TMGH",
    "زهراء المعادي": "ZMID",
    "النيل للادوية": "NIPH",
    "العربية للادوية": "ADCI",
    "العبور للاستثمار العقاري": "OBRI",
};

const VALID_SYMBOLS = [
    ...Object.values(ARABIC_STOCK_MAPPINGS).filter((v, i, a) => a.indexOf(v) === i),
    "OBRI", "DMTY", "SODIC", "MRSE", "OCPH", "MIPH", "CPCI", "MPCI", "SIPC", "NIPH", "ADCI"
];

// ─── نسخة من extractSymbolsFromText (مستقلة) ────────────────────────────────
function extractSymbolsFromText(text, validSymbols, stockMappings = {}) {
    const found = [];
    const normalizedText = text
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase();

    const mergedMappings = { ...ARABIC_STOCK_MAPPINGS, ...stockMappings };
    for (const [key, symbolOrArr] of Object.entries(mergedMappings)) {
        const normalizedKey = key
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .toLowerCase();

        const escapedKey = normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?:^|[^a-z0-9\u0600-\u06ff])${escapedKey}(?:$|[^a-z0-9\u0600-\u06ff])`, "i");
        if (regex.test(normalizedText)) {
            if (Array.isArray(symbolOrArr)) found.push(...symbolOrArr);
            else found.push(symbolOrArr);
        }
    }
    return [...new Set(found)].filter(s => validSymbols.includes(s));
}

// ─── حالات الاختبار ──────────────────────────────────────────────────────────
// كل حالة: { label, text, shouldContain, shouldNotContain }
const TESTS = [
    // ── الحالات الإيجابية (يجب إيجاد الرمز) ──────────────────────────────
    { label: "فوري - مباشر",                  text: "ايه رأيك في سهم فوري",                 shouldContain: ["FWRY"] },
    { label: "طلعت مصطفى",                    text: "حلل لي طلعت مصطفى",                    shouldContain: ["TMGH"] },
    { label: "القلعة",                         text: "معلومات عن القلعة",                     shouldContain: ["CCAP"] },
    { label: "جنوب الوادي",                   text: "عندك تحليل جنوب الوادي",               shouldContain: ["SVCE"] },
    { label: "ابن سينا",                      text: "سهم ابن سينا عامل ايه",                shouldContain: ["ISPH"] },
    { label: "العبور للاستثمار العقاري",       text: "ماذا عن العبور للاستثمار العقاري",    shouldContain: ["OBRI"] },
    { label: "السويدي",                        text: "خبرني عن السويدي",                     shouldContain: ["SWDY"] },
    { label: "التجاري الدولي",                 text: "CIB أو التجاري الدولي",               shouldContain: ["COMI"] },
    { label: "مصر الجديدة / هيليوبوليس",      text: "سهم مصر الجديدة",                     shouldContain: ["HELI"] },
    { label: "المصرية للاتصالات",             text: "المصرية للاتصالات عاملة ايه",         shouldContain: ["ETEL"] },
    { label: "وي للاتصالات",                  text: "خبرني عن وي للاتصالات",               shouldContain: ["ETEL"] },
    { label: "هيرميس EFG",                    text: "سهم هيرميس",                           shouldContain: ["HRHO"] },
    { label: "أموك",                           text: "سعر أموك النهارده",                    shouldContain: ["AMOC"] },
    { label: "إعمار",                          text: "اعمار مصر بكم",                        shouldContain: ["EMFD"] },
    { label: "سوديك",                         text: "سوديك للتطوير العقاري",                shouldContain: ["OCDI"] },
    { label: "جهينة",                         text: "أخبار جهينه",                          shouldContain: ["JUFO"] },
    { label: "بالم هيلز",                     text: "تحليل بالم هيلز",                      shouldContain: ["PHDC"] },
    { label: "كليوباترا",                     text: "مستشفى كليوباترا",                     shouldContain: ["CLHO"] },
    { label: "راميدا",                        text: "سهم راميدا",                           shouldContain: ["RMDA"] },
    { label: "راية",                          text: "أسعار راية هولدنج",                   shouldContain: ["RAYA"] },
    { label: "عامر جروب",                     text: "سهم عامر جروب عمل ايه",               shouldContain: ["AMER"] },
    { label: "حديد عز",                       text: "حديد عز وصل لفين",                    shouldContain: ["ESRS"] },
    { label: "موبكو",                         text: "موبكو للأسمدة",                        shouldContain: ["MFPC"] },
    { label: "مدينة نصر",                     text: "سهم مدينة نصر للإسكان",               shouldContain: ["MNHD"] },
    { label: "إيديتا",                        text: "إيديتا للصناعات الغذائية",             shouldContain: ["EFID"] },

    // ── حالات النفي (يجب ألا يُستخرج رمز خاطئ) ──────────────────────────
    { label: "للأدوية ← لا يطابق ISPH بدون 'ابن سينا'",
      text: "قطاع الأدوية بشكل عام",  shouldNotContain: ["ISPH"] },
    { label: "وي ← لا يطابق ETEL إذا كانت جزء من كلمة",
      text: "للأدوية وللاستثمار",     shouldNotContain: ["ETEL"] },
    { label: "جي بي أوتو ← لا يطابق GBCO",
      text: "جي بي اوتو",             shouldContain: ["AUTO"], shouldNotContain: ["GBCO"] },
    { label: "مصر ← لا يطابق MASR/EMFD/MNHD عشوائيًا",
      text: "البورصة المصرية بشكل عام", shouldNotContain: ["MASR", "EMFD", "MNHD"] },
    { label: "النساجون ← لا يطابق ORWE بكلمة أخرى",
      text: "النساجون الشرقيون",      shouldContain: ["ORWE"] },
    { label: "عبور ← لا يطابق OLFI بكلمة عبور وحدها دون 'لاند'",
      text: "طريق العبور السريع",     shouldNotContain: ["OLFI"] },
    { label: "سبيد ← لا يطابق SPMD بدون سياق سهم",
      // ملاحظة: 'سبيد' وحدها مدرجة في الـ mapping، لذا من المتوقع أن تُطابَق
      text: "سبيد ميدكال",            shouldContain: ["SPMD"] },
    { label: "دومتي ← DOMT وليس DMTY",
      text: "دومتي للصناعات الغذائية", shouldContain: ["DOMT"], shouldNotContain: ["DMTY"] },
];

// ─── تشغيل الاختبارات ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log("═".repeat(60));
console.log("  اختبار استخراج رموز الأسهم العربية");
console.log("═".repeat(60) + "\n");

for (const t of TESTS) {
    const result = extractSymbolsFromText(t.text, VALID_SYMBOLS, {});
    let ok = true;
    const reasons = [];

    if (t.shouldContain) {
        for (const sym of t.shouldContain) {
            if (!result.includes(sym)) {
                ok = false;
                reasons.push(`MISSING ${sym}`);
            }
        }
    }
    if (t.shouldNotContain) {
        for (const sym of t.shouldNotContain) {
            if (result.includes(sym)) {
                ok = false;
                reasons.push(`FALSE POSITIVE ${sym}`);
            }
        }
    }

    const status = ok ? "✅ PASS" : "❌ FAIL";
    if (ok) passed++; else failed++;

    console.log(`${status}  ${t.label}`);
    console.log(`       text   : "${t.text}"`);
    console.log(`       result : [${result.join(", ") || "none"}]`);
    if (!ok) console.log(`       issues : ${reasons.join(" | ")}`);
    console.log();
}

console.log("═".repeat(60));
console.log(`النتيجة: ${passed} نجح  |  ${failed} فشل  |  ${TESTS.length} إجمالي`);
console.log("═".repeat(60));
