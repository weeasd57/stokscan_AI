const fs = require('fs');

// Simple escape function for RegExp
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Restored ARABIC_STOCK_MAPPINGS
const ARABIC_STOCK_MAPPINGS = {
    "القلعة": "CCAP", "القلعه": "CCAP", "شركة القلعة": "CCAP",
    "فوري": "FWRY", "فورى": "FWRY", "فوري لتكنولوجيا البنوك": "FWRY",
    "طلعت مصطفى": "TMGH", "مجموعة طلعت مصطفى": "TMGH",
    "إعمار": "EMFD", "اعمار": "EMFD", "اعمار مصر": "EMFD",
    "أبو قير": "ABUK", "ابو قير": "ABUK", "ابوقير للأسمدة": "ABUK", "أبو قير للأسمدة": "ABUK",
    "مصر للألومنيوم": "EGAL", "مصر للالومنيوم": "EGAL", "الومنيوم مصر": "EGAL",
    "حديد عز": "ESRS", "عز الحديد": "ESRS", "عز الدخيلة": "ESRS",
    "مصر بني سويف": "MBSC", "بني سويف للأسمنت": "MBSC",
    "السويدي": "SWDY", "السويدى": "SWDY", "السويدي إلكتريك": "SWDY",
    "مدينة نصر": "MNHD", "مدينة مصر": "MNHD",
    "بالم هيلز": "PHDC",
    "المصرية للاتصالات": "ETEL", "وي للاتصالات": "ETEL", "اتصالات مصر": "ETEL", "وي": "ETEL", // "وي" is here
    "ابن سينا": "ISPH", "ابن سينا فارما": "ISPH", "ابن سينا للادوية": "ISPH", "ابن سينا للأدوية": "ISPH",
    "جهينة": "JUFO", "جهينه": "JUFO",
    "بلتون": "BTFH", "إي فاينانس": "EFIH", "اي فاينانس": "EFIH",
    "النساجون": "ORWE", "النساجون الشرقيون": "ORWE",
    "اوراسكوم": "ORAS", "أوراسكوم": "ORAS", "اوراسكوم للتنمية": "ORHD",
    "سيدي كرير": "SKPC", "سيدى كرير": "SKPC", "اموك": "AMOC", "أموك": "AMOC",
    "موبكو": "MFPC", "القاهرة للدواجن": "POUL", "المنصورة للدواجن": "MPCO",
    "دومتي": "DMTY", "عبور لاند": "OLFI", "كليوباترا": "CLHO", "اجواء": "AJWA", "أجواء": "AJWA",
    "جلاكسو": "BIOC", "جلاكسو سميث كلاين": "BIOC", "العبور للاستثمار": "OBRI", "العبور للاستثمار العقاري": "OBRI",
    "ايبكو": "PHAR", "إيبكو": "PHAR", "ايبيكو": "PHAR", "إيبيكو": "PHAR",
    "مطاحن اسكندرية": "AFMC", "مطاحن الإسكندرية": "AFMC", "مطاحن الاسكندرية": "AFMC",
    "جنوب الوادي": "SVCE", "جنوب الوادى": "SVCE", "جنوب الوادي للاسمنت": "SVCE", "جنوب الوادى للاسمنت": "SVCE",
    "القاهرة للإسكان": "ELKA", "القاهرة للاسكان": "ELKA", "القاهرة والاسكان": "ELKA",
    "القاهره والاسكان": "ELKA", "القاهره للاسكان": "ELKA", "إلكا": "ELKA", "الكا": "ELKA",
    "elka": "ELKA", "Elka": "ELKA",
    "القاهرة للإسكان والتعمير": "ELKA", "القاهرة للاسكان والتعمير": "ELKA", "القاهره للاسكان والتعمير": "ELKA",
    "فوديكو": "INFI",
    "التعمير والاستشارات": "MRSE",
    "سوديك": "SODIC", "مراسم": "MASR", "هيليوبوليس": "HELI",
    "سيرا": "CIRA", "بنك الكوميرشال": "COMI", "كوميرشال": "COMI",
    "الشرق الاوسط": "EAST", "الشرق الأوسط": "EAST",
    "رمضة": "RMDA", "اكتوبر فارما": "OCPH", "مينا فارم": "MIPH",
    "سبيد ميدكال": "SPMD", "كايرو فارما": "CPCI", "ميمفيس": "MPCI",
    "النيل للادوية": "NIPH", "النيل فارما": "NIPH",
    "سيمبا": "SIPC", "العربي للادوية": "ADCI", "العربية للادوية": "ADCI"
};

const STATIC_VALID_SYMBOLS = [
    'AALR', 'ABUK', 'ACAMD', 'ACAP', 'ADCI', 'ADPC', 'AFMC', 'AIH', 'AIIH', 'AJWA', 'ALCN', 'ALUM', 'AMES', 'AMOC',
    'APPC', 'ARAB', 'AREH', 'ARVA', 'ATQA', 'AXPH', 'BIOC', 'BTFH', 'CCAP', 'CIEB', 'CIRA', 'CLHO',
    'CNFN', 'COMI', 'COPR', 'CPCI', 'CRST', 'DMTY', 'EAST', 'EEII', 'EFID', 'EFIH', 'EGAL', 'EGAS', 'EGBE',
    'EGCH', 'EGREF', 'EGSA', 'EGTS', 'EGX30', 'EGX70', 'EGX100', 'EHDR', 'EITP', 'EKHO', 'ELKA', 'ELSH', 'EMFD', 'EOSB',
    'ESRS', 'ETEL', 'ETRS', 'FAIT', 'FERC', 'FTNS', 'FWRY', 'GBCO', 'GDWA', 'GGCC', 'GGRN', 'GMCI', 'GOUR',
    'GSSC', 'HELI', 'HRHO', 'ICFC', 'IDRE', 'INFI', 'IRON', 'ISMA', 'ISPH', 'JUFO', 'KABO', 'KASABF',
    'KRDI', 'KWIN', 'KZPC', 'LUTS', 'MASR', 'MBSC', 'MCQE', 'MENA', 'MFPC', 'MFSC', 'MICH', 'MILS', 'MNHD',
    'MOIL', 'MOSC', 'MPCO', 'MTIE', 'NCGC', 'NEDA', 'NHPS', 'NINH', 'NIPH', 'OBRI', 'OLFI', 'ORAS', 'ORHD', 'ORWE', 'PHDC', 'PHTV',
    'PHAR', 'POUL', 'PRDC', 'RACC', 'RREI', 'RTVC', 'RUBX', 'SAUD', 'SCEM', 'SCTS', 'SEIG', 'SIPC', 'SKPC', 'SNFC', 'SODIC', 'SVCE',
    'SPIN', 'SWDY', 'TANM', 'TAQA', 'TMGH', 'TRTO', 'TWSA', 'TYCN', 'UEFM', 'UNIT', 'USDEGP', 'VALU', 'VLMRA', 'WATP', 'MRSE'
];

function normalizeArabic(str) {
    return str
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
}

function extractSymbolsOriginal(text) {
    const found = [];
    const normalizedText = normalizeArabic(text);

    for (const [key, symbol] of Object.entries(ARABIC_STOCK_MAPPINGS)) {
        const normalizedKey = normalizeArabic(key);
        if (normalizedText.includes(normalizedKey)) {
            found.push(symbol);
        }
    }
    return Array.from(new Set(found)).filter(s => STATIC_VALID_SYMBOLS.includes(s));
}

function extractSymbolsSmart(text) {
    const found = [];
    const normalizedText = normalizeArabic(text);

    for (const [key, symbol] of Object.entries(ARABIC_STOCK_MAPPINGS)) {
        const normalizedKey = normalizeArabic(key);
        
        // Use word boundary detection with support for Arabic characters
        // If the key is short (<= 3 characters), enforce word boundaries to avoid false substring matches
        if (normalizedKey.length <= 3) {
            const regex = new RegExp(`(?:^|[^a-z0-9\\u0600-\\u06ff])${escapeRegExp(normalizedKey)}(?:$|[^a-z0-9\\u0600-\\u06ff])`, 'i');
            if (regex.test(normalizedText)) {
                found.push(symbol);
            }
        } else {
            // For longer names, substring matching is generally safe and helps match partials
            if (normalizedText.includes(normalizedKey)) {
                found.push(symbol);
            }
        }
    }
    return Array.from(new Set(found)).filter(s => STATIC_VALID_SYMBOLS.includes(s));
}

const testCases = [
    { query: "ممكن العبور للاستثمار وجنوب الوادى وفوري", expected: ["OBRI", "SVCE", "FWRY"] },
    { query: "ابن سينا فارما للادويه", expected: ["ISPH"] }, // Should NOT include ETEL (from "وي" matched in "للادويه")
    { query: "داخل بكرة في جلاكسو وإيبكو ومطاحن إسكندرية باتنين مليون", expected: ["BIOC", "PHAR", "AFMC"] },
    { query: "ابيع ايبكو ولا اي عملت ٤٠٪", expected: ["PHAR"] },
    { query: "ما رايكم في ابن سينا فارما للادويه", expected: ["ISPH"] },
    { query: "فوديكو", expected: ["INFI"] },
    { query: "التعمير والاستشارات", expected: ["MRSE"] },
    { query: "ايبيكو", expected: ["PHAR"] },
    { query: "سهم فوري وي", expected: ["FWRY", "ETEL"] } // standalone "وي" should match ETEL
];

console.log("--- RUNNING PARSER TESTS ---");
let originalPassed = 0;
let smartPassed = 0;

testCases.forEach((tc, idx) => {
    const origResult = extractSymbolsOriginal(tc.query);
    const smartResult = extractSymbolsSmart(tc.query);
    
    const origOk = JSON.stringify(origResult.sort()) === JSON.stringify(tc.expected.sort());
    const smartOk = JSON.stringify(smartResult.sort()) === JSON.stringify(tc.expected.sort());
    
    if (origOk) originalPassed++;
    if (smartOk) smartPassed++;
    
    console.log(`Test ${idx + 1}: "${tc.query}"`);
    console.log(`  Expected: ${JSON.stringify(tc.expected)}`);
    console.log(`  Original: ${JSON.stringify(origResult)} -> ${origOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Smart   : ${JSON.stringify(smartResult)} -> ${smartOk ? 'PASS' : 'FAIL'}`);
    console.log();
});

console.log(`Original Parser Passed: ${originalPassed}/${testCases.length}`);
console.log(`Smart Parser Passed: ${smartPassed}/${testCases.length}`);
