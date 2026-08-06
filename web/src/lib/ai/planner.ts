
// ============================================================
// ARABIC_STOCK_MAPPINGS — مُحدَّث من قاعدة البيانات
// قواعد الإضافة:
//  1. الكلمات القصيرة (≤3 أحرف) لا تُضاف وحدها لتجنب التعارض
//  2. كل مدخل يُطابَق بنظام word-boundary (regex) في extractSymbolsFromText
//  3. الأولوية للمسمى الأطول عند وجود تعارض محتمل
// ============================================================
const ARABIC_STOCK_MAPPINGS: Record<string, string> = {

    // ── ABUK  أبو قير للأسمدة ──────────────────────────────
    "أبو قير": "ABUK", "ابو قير": "ABUK",
    "ابوقير للأسمدة": "ABUK", "أبو قير للأسمدة": "ABUK",

    // ── ADIB  بنك أبو ظبي الإسلامي ─────────────────────────
    "ابو ظبي الاسلامي": "ADIB", "ابو ظبي للاستثمار": "ADIB",
    "بنك ابو ظبي": "ADIB",

    // ── AFMC  مطاحن الإسكندرية ─────────────────────────────
    "مطاحن الإسكندرية": "AFMC", "مطاحن الاسكندرية": "AFMC",
    "مطاحن اسكندرية": "AFMC",

    // ── AJWA  أجواء ─────────────────────────────────────────
    "أجواء للصناعات الغذائية": "AJWA", "اجواء للصناعات الغذائية": "AJWA",

    // ── AMER  عامر جروب ─────────────────────────────────────
    "عامر جروب": "AMER", "عامر هولدنج": "AMER",

    // ── AMOC  أموك ──────────────────────────────────────────
    "أموك": "AMOC", "اموك": "AMOC",
    "الاسكندرية للزيوت المعدنية": "AMOC",

    // ── AUTO  جي بي أوتو ────────────────────────────────────
    "جي بي اوتو": "AUTO", "جي بي أوتو": "AUTO", "gb اوتو": "AUTO",

    // ── BIOC  جلاكسو سميث كلاين ─────────────────────────────
    "جلاكسو سميث كلاين": "BIOC", "جلاكسو": "BIOC",

    // ── BTFH  بلتون ──────────────────────────────────────────
    "بلتون": "BTFH", "بلتون للقابضة": "BTFH",

    // ── CCAP  القلعة ─────────────────────────────────────────
    "القلعة": "CCAP", "القلعه": "CCAP", "شركة القلعة": "CCAP",
    "قلعة للاستثمارات": "CCAP",

    // ── CIEB  كريدي أجريكول ──────────────────────────────────
    "كريدي اجريكول": "CIEB", "كريدي أجريكول": "CIEB",
    "بنك كريدي اجريكول": "CIEB",

    // ── CIRA  سيرا ──────────────────────────────────────────
    "سيرا": "CIRA", "سيرا للتعليم": "CIRA",

    // ── CLHO  مستشفى كليوباترا ──────────────────────────────
    "كليوباترا": "CLHO", "مستشفى كليوباترا": "CLHO",

    // ── COMI  التجاري الدولي CIB ─────────────────────────────
    "التجاري الدولي": "COMI", "بنك التجاري الدولي": "COMI",

    // ── DOMT  دومتي ─────────────────────────────────────────
    "دومتي": "DOMT",

    // ── DSCW  دايس ──────────────────────────────────────────
    "دايس": "DSCW",

    // ── EAST  الشرقية للدخان ────────────────────────────────
    "الشرقية للدخان": "EAST", "الشرقيه للدخان": "EAST",
    "ايسترن كومباني": "EAST", "ايسترن": "EAST",

    // ── EFID  إيديتا ─────────────────────────────────────────
    "إيديتا": "EFID", "ايديتا": "EFID",

    // ── EFIH  إي فاينانس ─────────────────────────────────────
    "إي فاينانس": "EFIH", "اي فاينانس": "EFIH",
    "إي فاينانس للاستثمارات": "EFIH",

    // ── EGAL  مصر للألومنيوم ────────────────────────────────
    "مصر للألومنيوم": "EGAL", "مصر للالومنيوم": "EGAL",
    "الومنيوم مصر": "EGAL",

    // ── EGCH  كيما ──────────────────────────────────────────
    "كيما": "EGCH", "كيما للكيماويات": "EGCH",

    // ── ELKA  القاهرة للإسكان ───────────────────────────────
    "القاهرة للإسكان": "ELKA", "القاهرة للاسكان": "ELKA",
    "القاهره للاسكان": "ELKA", "القاهرة والاسكان": "ELKA",
    "القاهره والاسكان": "ELKA",
    "القاهرة للإسكان والتعمير": "ELKA",
    "القاهرة للاسكان والتعمير": "ELKA",
    "إلكا": "ELKA", "الكا": "ELKA",

    // ── ELSH  الشمس للإسكان ──────────────────────────────────
    "الشمس للإسكان": "ELSH", "الشمس للاسكان": "ELSH",

    // ── EMFD  إعمار مصر ──────────────────────────────────────
    "إعمار": "EMFD", "اعمار": "EMFD", "اعمار مصر": "EMFD",

    // ── ESRS  حديد عز ────────────────────────────────────────
    "حديد عز": "ESRS", "عز الحديد": "ESRS", "عز الدخيلة": "ESRS",

    // ── ETEL  المصرية للاتصالات / وي ────────────────────────
    "المصرية للاتصالات": "ETEL", "المصريه للاتصالات": "ETEL",
    "اتصالات مصر": "ETEL", "وي للاتصالات": "ETEL",

    // ── FWRY  فوري ───────────────────────────────────────────
    "فوري": "FWRY", "فورى": "FWRY",
    "فوري لتكنولوجيا البنوك": "FWRY",

    // ── GBCO  جي بي كورب / GB Auto ──────────────────────────
    "جي بي كورب": "GBCO",
    "جدوى": "GDWA", "جدوي": "GDWA", "العبور": "OBRI",

    // ── HELI  هيليوبوليس / مصر الجديدة ──────────────────────
    "مصر الجديدة": "HELI", "مصر الجديده": "HELI",
    "هيليوبوليس": "HELI",
    
    // ── أسهم إضافية مأخوذة من Supabase ───────────────────────
    "العامة لاستصلاح الاراضي": "AALR", "العامة لاستصلاح الأراضي": "AALR", "عامة استصلاح": "AALR",
    "العربية لإدارة الأصول": "ACAMD", "العربية لادارة الاصول": "ACAMD", "العربية للأصول": "ACAMD",
    "اي كابيتال": "ACAP", "أكابيتال": "ACAP", "ايه كابيتال": "ACAP",
    "العربية لحليج الاقطان": "ACGC", "العربية لحليج الأقطان": "ACGC", "حليج الاقطان": "ACGC",
    "أكرو": "ACRO", "اكرو": "ACRO", "أكرو مصر": "ACRO",
    "أكت فاينانشال": "ACTF", "اكت فاينانشال": "ACTF", "شركة أكت": "ACTF",
    "باندا": "ADPC", "أراب ديري": "ADPC", "اراب ديري": "ADPC", "ألبان العرب": "ADPC",
    "الأهلي للتنمية": "AFDI", "الاهلي للتنمية": "AFDI", "الاهلي للاستثمار": "AFDI",
    "حاويات": "ALCN", "حاويات اسكندرية": "ALCN", "الاسكندرية للحاويات": "ALCN", "الإسكندرية للحاويات": "ALCN", "حاوية": "ALCN",
    "أسمنت الإسكندرية": "ALEX", "اسمنت الاسكندرية": "ALEX",
    "العربية للألومنيوم": "ALUM", "العربية للالومنيوم": "ALUM", "الومنيوم العرب": "ALUM",
    "المركز الطبي بأسكندرية": "AMES", "اسكندرية للمركز الطبي": "AMES",
    "الملتقى العربي": "AMIA", "الملتقى": "AMIA", "الملتقي العربي": "AMIA",
    "التعبئة والتغليف": "APPC", "الدوائية للتعبئة": "APPC",
    "بولفارا": "APSW", "العربية بولفارا": "APSW", "بوليفارا": "APSW",
    "المطورون العرب": "ARAB", "عرب ديفلوبرز": "ARAB",
    "العربية للأسمنت": "ARCC", "العربية للاسمنت": "ARCC",
    "المجموعة العقارية": "AREH", "عقارية مصرية": "AREH",
    "صمامات العرب": "ARVA", "العربية للصمامات": "ARVA",
    "أسباير": "ASPI", "اسباير": "ASPI", "أسباير كابيتال": "ASPI",
    "التوفيق للتأجير": "ATLC", "التوفيق لتاجير": "ATLC", "أي تي ليز": "ATLC",
    "عتاقة": "ATQA", "عتاقه": "ATQA", "صلب عتاقة": "ATQA", "مصر الوطنية للصلب": "ATQA",
    "إسكندرية للأدوية": "AXPH", "اسكندرية للادوية": "AXPH", "الإسكندرية للأدوية": "AXPH",
    "بي انفستمنتس": "BINV", "بي إنفيستمنتس": "BINV", "بي للاستثمار": "BINV",
    "بنيان": "BONY", "بنيان للتنمية": "BONY",
    "القاهرة للتعليم": "CAED", "القاهرة للخدمات التعليمية": "CAED",
    "قناة السويس": "CANA", "بنك قناة السويس": "CANA", "بنك القناة": "CANA",
    "الخليج الكندي": "CCRS", "خليج كندي": "CCRS",
    "مطاحن مصر الوسطى": "CEFM", "مصر الوسطى للمطاحن": "CEFM",
    "ريماس": "CERA", "سيراميكا ريماس": "CERA", "ريماس للسيراميك": "CERA",
    "كونكريت": "CFGH", "كونكريت فاشون": "CFGH",
    "سي اي كابيتال": "CICH", "سي أي كابيتال": "CICH", "سي آي كابيتال": "CICH",
    "كونتكت": "CNFN", "كونتكت المالية": "CNFN", "ثروة كابيتال": "CNFN",
    "كوبـر": "COPR", "كوبر": "COPR", "كوبر للاستثمار": "COPR",
    "القاهرة للزيوت": "COSG", "زيوت وصابون": "COSG", "قاهرة للزيوت": "COSG",
    "القاهرة للأدوية": "CPCI", "القاهرة للادوية": "CPCI",
    "القناة للتوكيلات": "CSAG", "قناة للتوكيلات": "CSAG", "توكيلات ملاحية": "CSAG",
    "الاستشارات الهندسية": "DAPH", "تنمية واستشارات": "DAPH",
    "الدلتا للإنشاء": "DCRC", "دلتا للانشاء": "DCRC",
    "الدلتا للتأمين": "DEIN", "دلتا للتامين": "DEIN",
    "دايس للملابس": "DSCW",
    "الدلتا للطباعة": "DTPP", "دلتا طباعة": "DTPP",
    "العربية لاستصلاح الاراضي": "EALR", "العربية لاستصلاح الأراضي": "EALR",
    "الجوهرة": "ECAP", "الجوهرة للسيراميك": "ECAP", "عز للسيراميك": "ECAP",
    "مطاحن شرق الدلتا": "EDFM", "شرق الدلتا للمطاحن": "EDFM",
    "الهندسية للاستثمار": "EEII", "العربية الهندسية": "EEII",
    "المالية والصناعية": "EFIC", "المالية والصناعية المصرية": "EFIC", "كفر الزيات للمالية": "EFIC",
    "غاز مصر": "EGAS", "ايجاس": "EGAS", "إيجاس": "EGAS",
    "المصري الخليجي": "EGBE", "المصرى الخليجى": "EGBE", "بنك ايجي بنك": "EGBE", "ايجي بنك": "EGBE",
    "المصرية للمنتجعات": "EGTS", "منتجعات سياحية": "EGTS", "سهل حشيش": "EGTS",
    "المصريين للإسكان": "EHDR", "المصريون للاسكان": "EHDR", "المصريين للاسكان": "EHDR",
    "المشروعات السياحية": "EITP", "مصر للسياحة": "EITP",
    "الكابلات الكهربائية": "ELEC", "كابلات مصر": "ELEC", "الكابلات": "ELEC",
    "النصر للمحاصيل": "ELNA", "محاصيل زراعية": "ELNA",
    "الهندسية للصناعات": "ENGC",
    "العروبة للسمسرة": "EOSB", "العروبة للوساطة": "EOSB",
    "ايجترانس": "ETRS", "إيجترانس": "ETRS", "المصرية للنقل": "ETRS",
    "تنمية الصادرات": "EXPA", "بنك تنمية الصادرات": "EXPA", "المصري للتمويل": "EXPA",
    "فيصل دولار": "FAITA",
    "جدوى التنمية": "GDWA",
    "الجيزة العامة": "GGCC", "جيزة مقاولات": "GGCC", "الجيزة للمقاولات": "GGCC",
    "جو جرين": "GGRN", "جو جرين للاستثمار": "GGRN", "جرين": "GGRN",
    "الغربية للإسكان": "GIHD", "الغربية للاسكان": "GIHD",
    "جي ام سي": "GMCI", "جي أم سي": "GMCI",
    "جولدن بيراميدز": "GPPL", "سيتي ستارز": "GPPL",
    "العامة للصوامع": "GSSC", "الصوامع والتخزين": "GSSC",
    "جيتكس": "GTEX", "جيتكس للأثاث": "GTEX",
    "جولدن تكس": "GTWL", "الذهب للمنسوجات": "GTWL",
    "التعمير والإسكان": "HDBK", "التعمير والاسكان": "HDBK", "بنك التعمير والاسكان": "HDBK", "بنك الاسكان": "HDBK",
    "الدولية للمخصبات": "ICFC", "مخصبات": "ICFC",
    "الدولية للاستثمار": "ICID", "الدولية للتنمية": "ICID",
    "الإسماعيلية للتطوير": "IDRE", "الاسماعيلية للاسكان": "IDRE",
    "المشروعات الهندسية": "IEEC",
    "الإسماعيلية للأغذية": "INFI", "الاسماعيلية الدواجن": "INFI",
    "إسماعيلية للدواجن": "ISMA", "اسماعيلية مصر للدواجن": "ISMA",
    "حديد ومناجم": "ISMQ", "مناجم ومحاجر": "ISMQ", "مناجم الصلب": "ISMQ",
    "كابو": "KABO", "النصر للملابس كابو": "KABO",
    "نهر الخير": "KRDI", "نهر الخير للتنمية": "KRDI",
    "القاهرة الوطنية": "KWIN", "قاهرة للاستثمار": "KWIN",
    "كفر الزيات للمبيدات": "KZPC", "كفر الزيات": "KZPC",
    "ليسيكو": "LCSW", "ليسيكو مصر": "LCSW",
    "مرسيليا": "MAAL", "مرسيليا المصرية": "MAAL", "مرسيليا للاستثمار": "MAAL",
    "ام بي للهندسة": "MBEG", "أم بي للهندسة": "MBEG",
    "أسمنت قنا": "MCQE", "اسمنت قنا": "MCQE", "مصر للاسمنت قنا": "MCQE",
    "ماكرو": "MCRO", "ماكرو جروب": "MCRO", "ماكرو فارما": "MCRO",
    "مينا للاستثمار": "MENA", "مينا السياحية": "MENA",
    "الطبية للعبوات": "MEPA", "عبوات طبية": "MEPA",
    "مصر لإنتاج الاسمدة": "MFPC", "مصر لإنتاج الأسمدة موبكو": "MFPC",
    "مصر للأسواق الحرة": "MFSC", "الأسواق الحرة": "MFSC", "الاسواق الحرة": "MFSC",
    "مصر للفنادق": "MHOT", "فنادق مصر": "MHOT",
    "مصر الكيماويات": "MICH", "مصر لصناعة الكيماويات": "MICH",
    "مطاحن شمال القاهرة": "MILS", "شمال القاهرة للمطاحن": "MILS",
    "مينا فارم": "MIPH", "مينافارم": "MIPH", "مينا فارم للأدوية": "MIPH",
    "الحديثة للتعليم": "MOED", "المصرية للتعليم": "MOED",
    "مارديف": "MOIL", "ماريديف": "MOIL", "الخدمات الملاحية": "MOIL",
    "المهندس للتأمين": "MOIN", "المهندس للتامين": "MOIN",
    "مصر للزيوت والصابون": "MOSC",
    "ممفيس": "MPCI", "ممفيس للأدوية": "MPCI", "ممفيس للادوية": "MPCI",
    "إنتاج إعلامي": "MPRC", "الانتاج الاعلامي": "MPRC", "مدينة الانتاج الاعلامي": "MPRC", "الإنتاج الإعلامي": "MPRC",
    "ام ام جروب": "MTIE", "إم إم جروب": "MTIE", "ام.ام جروب": "MTIE",
    "النعيم": "NAHO", "النعيم القابضة": "NAHO",
    "النصر": "NASR", "النصر للمقاولات": "NASR",
    "الكويت الوطني": "NBKE", "بنك الكويت الوطني": "NBKE", "الكويت الوطني مصر": "NBKE",
    "النصر للأعمال المدنية": "NCCW", "النصر للاعمال المدنية": "NCCW",
    "النيل لحليج الاقطان": "NCGC", "النيل لحليج الأقطان": "NCGC",
    "شمال الصعيد": "NEDA", "شمال الصعيد للتنمية": "NEDA", "نيوداب": "NEDA",
    "أكتوبر فارما": "OCPH", "اكتوبر فارما": "OCPH",
    "أودن": "ODIN", "اودن": "ODIN", "أودن للاستثمار": "ODIN",
    "أوراسكوم المالي": "OFH", "اوراسكوم المالي": "OFH", "او اف اتش": "OFH",
    "أوراسكوم للاستثمار": "OIH", "اوراسكوم للاستثمار": "OIH", "اوراسكوم هولدنج": "OIH",
    "أوراسكوم كونستراكشون": "ORAS",
    "باكين": "PACH", "البويات والصناعات الكيماوية": "PACH",
    "بالم هيلز للتعمير": "PHDC",
    "بيراميزا": "PHTV", "بيراميزا للفنادق": "PHTV",
    "قاهرة للدواجن": "POUL",
    "الخزف والصيني": "PRCL", "شيني": "PRCL",
    "بايونيرز بروبرتيز": "PRDC",
    "برايم": "PRMH", "برايم القابضة": "PRMH",
    "قطر الوطني": "QNBE", "بنك قطر الوطني": "QNBE", "QNB": "QNBE", "كيو ان بي": "QNBE",
    "راية للاتصالات": "RACC", "راية كونتاكت": "RACC",
    "راكتا": "RAKT", "ورق راكتا": "RAKT", "رواد السياحة": "ROTO", "الرواد للسياحة": "ROTO",
    "العربية للاستثمار العقاري": "RREI", "عرب عقارات": "RREI",
    "رمكو": "RTVC", "رمكو للقرى السياحية": "RTVC",
    "روبكس": "RUBX", "روبكس البلاستيك": "RUBX",
    "البركة": "SAUD", "بنك البركة": "SAUD", "بنك البركة مصر": "SAUD",
    "أسمنت سيناء": "SCEM", "اسمنت سيناء": "SCEM",
    "مطاحن جنوب القاهرة": "SCFM", "جنوب القاهرة للمطاحن": "SCFM",
    "قناة السويس للتكنولوجيا": "SCTS",
    "شرم دريمز": "SDTI", "شرم دريمز للسياحة": "SDTI",
    "السعودية المصرية": "SEIG", "السعودية المصرية للاستثمار": "SEIG",
    "سبأ": "SIPC", "سبأ للأدوية": "SIPC", "سبأ للادوية": "SIPC",
    "سيدي كرير للبتروكيماويات": "SKPC",
    "سماد مصر": "SMFR", "ايجيفرت": "SMFR",
    "الشروق للطباعة": "SMPP", "الشروق تغليف": "SMPP",
    "الشرقية الوطنية للأغذية": "SNFC", "الشرقية اغذية": "SNFC",
    "الدلتا للسكر": "SUGR", "سكر الدلتا": "SUGR", "الدلتا سكر": "SUGR",
    "تعليم": "TALM", "تعليم لخدمات الإدارة": "TALM",
    "طاقة عربية": "TAQA", "طاقة": "TAQA", "طاقه عربيه": "TAQA",
    "طلعت مصطفي": "TMGH",
    "أسمنت طرة": "TORA", "اسمنت طرة": "TORA",
    "تايكون": "TYCN", "تايكون القابضة": "TYCN",
    "البنك المتحد": "UBEE", "المتحد": "UBEE",
    "مطاحن مصر العليا": "UEFM", "مصر العليا للمطاحن": "UEFM",
    "الصعيد العامة للمقاولات": "UEGC", "الصعيد مقاولات": "UEGC",
    "يونيباك": "UNIP", "العالمية للورق": "UNIP",
    "المتحدة للإسكان": "UNIT", "المتحدة للاسكان": "UNIT",
    "يوتوبيا": "UTOP", "يوتوبيا للاستثمار": "UTOP",
    "فاليو": "VALU", "فاليو فاينانس": "VALU",
    "وسط وغرب الدلتا": "WCDF", "مطاحن وسط الدلتا": "WCDF",
    "كوم امبو": "WKOL", "وادي كوم امبو": "WKOL", "وادي كوم أمبو": "WKOL",
    "الزيوت المستخلصة": "ZEOT", "مستخلصة زيوت": "ZEOT",
    "زهراء المعادى": "ZMID",
    "النزهة للاستثمار": "NINH",

    // ── HRHO  هيرميس / EFG ───────────────────────────────────
    "هيرميس": "HRHO", "المجموعة المالية هيرميس": "HRHO",
    "المجموعة المالية": "HRHO",
    "إي اف جي القابضة": "HRHO", "اي اف جي": "HRHO",

    // ── ISPH  ابن سينا فارما ─────────────────────────────────
    "ابن سينا": "ISPH", "ابن سينا فارما": "ISPH",
    "ابن سينا للادوية": "ISPH", "ابن سينا للأدوية": "ISPH",

    // ── JUFO  جهينة ──────────────────────────────────────────
    "جهينة": "JUFO", "جهينه": "JUFO",

    // ── LUTS لوتس للتنمية ─────────────────────────
    "لوتس": "LUTS", "لوتس للتنمية": "LUTS", "لوتس للاستثمار": "LUTS", "شركة لوتس": "LUTS",


    // ── MASR  مدينة مصر / Madinet Masr ──────────────────────
    "مدينة مصر": "MASR", "مدينه مصر": "MASR",
    "مدينة مصر للإسكان": "MASR",

    // ── MBSC  مصر بني سويف للأسمنت ──────────────────────────
    "مصر بني سويف": "MBSC", "بني سويف للأسمنت": "MBSC",

    // ── MCQE  مكادي ──────────────────────────────────────────
    "مكادي": "MCQE",

    // ── MFPC  موبكو ──────────────────────────────────────────
    "موبكو": "MFPC",

    // ── MNHD  مدينة نصر ──────────────────────────────────────
    "مدينة نصر": "MNHD", "مدينه نصر": "MNHD",
    "مدينة نصر للإسكان": "MNHD",

    // ── MPCO  المنصورة للدواجن ────────────────────────────────
    "المنصورة للدواجن": "MPCO", "المنصوره للدواجن": "MPCO",

    // ── OCDI  سوديك ──────────────────────────────────────────
    "سوديك": "OCDI",

    // ── OLFI  عبور لاند ──────────────────────────────────────
    "عبور لاند": "OLFI",

    // ── ORAS  أوراسكوم إنشاء ─────────────────────────────────
    "اوراسكوم للانشاء": "ORAS", "أوراسكوم للانشاء": "ORAS",
    "أوراسكوم إنشاءات": "ORAS",

    // ── ORHD  أوراسكوم للتنمية ───────────────────────────────
    "اوراسكوم للتنمية": "ORHD", "أوراسكوم للتنمية": "ORHD",
    "اوراسكوم ديفلوبمنت": "ORHD",

    // ── ORWE  النساجون الشرقيون ───────────────────────────────
    "النساجون": "ORWE", "النساجون الشرقيون": "ORWE",

    // ── PHDC  بالم هيلز ──────────────────────────────────────
    "بالم هيلز": "PHDC",

    // ── POUL  القاهرة للدواجن ─────────────────────────────────
    "القاهرة للدواجن": "POUL",

    // ── PRDC  بايونيرز ────────────────────────────────────────
    "بايونيرز": "PRDC",

    // ── RAYA  راية ───────────────────────────────────────────
    "راية": "RAYA", "راية هولدنج": "RAYA",

    // ── RMDA  راميدا ──────────────────────────────────────────
    "راميدا": "RMDA",

    // ── NIPH  النيل للأدوية ───────────────────────────
    "النيل": "NIPH", "النيل للادوية": "NIPH", "النيل للأدوية": "NIPH",
    "شركة النيل للادوية": "NIPH", "النيل للصناعات الدوائية": "NIPH",

    // ── SKPC  سيدي كرير ──────────────────────────────────────
    "سيدي كرير": "SKPC", "سيدى كرير": "SKPC",

    // ── SPMD  سبيد ميدكال ─────────────────────────────────────
    "سبيد ميدكال": "SPMD", "سبيد": "SPMD",

    // ── SVCE  جنوب الوادي للإسمنت ────────────────────────────
    "جنوب الوادي": "SVCE", "جنوب الوادى": "SVCE",
    "جنوب الوادي للاسمنت": "SVCE", "جنوب الوادى للاسمنت": "SVCE",

    // ── SWDY  السويدي إلكتريك ─────────────────────────────────
    "السويدي": "SWDY", "السويدى": "SWDY", "سويدي": "SWDY",
    "السويدي إلكتريك": "SWDY",

    // ── TMGH  طلعت مصطفى ──────────────────────────────────────
    "طلعت مصطفى": "TMGH", "مجموعة طلعت مصطفى": "TMGH",
    "هشام طلعت مصطفى": "TMGH",

    // ── ZMID  زهراء المعادي ───────────────────────────────────
    "زهراء المعادي": "ZMID",

    // ── أسهم إضافية شائعة الذكر ───────────────────────────────
    "ايبكو": "PHAR", "إيبكو": "PHAR", "ايبيكو": "PHAR", "إيبيكو": "PHAR",
    "مطاحن اسكندرية والغربية": "AFMC",
    "العبور للاستثمار": "OBRI",
    "العبور للاستثمار العقاري": "OBRI",
    "الشمس": "ELSH",
    "العربية للادوية": "ADCI",
    "مستشفى النزهة": "NINH", "مستشفي النزهة": "NINH",
    "النزهة الدولي": "NINH", "النزهه الدولي": "NINH",
    "النزهة": "NINH", "النزهه": "NINH",
};
import { SessionState, PlannerResult, VisionContext } from "./types";
import { AI_CONFIG } from "./config";
import { isBestBuyStockQuestion } from "./intent-policy";
import { createHash } from "crypto";
import { getSupabaseClient } from "@/lib/supabase/route-data";

let cachedStocks: Array<{ symbol: string; name: string; name_ar?: string | null }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60 * 24;

export interface StocksListData {
    stocksListStr: string;
    stockMappings: Record<string, string | string[]>;
}

const EGX30_CONSTITUENTS: string[] = [
    'COMI', 'TMGH', 'HRHO', 'EAST', 'SWDY', 'EFIH',
    'ABUK',  // Abu Qir Fertilizers
    'ETEL',  // Telecom Egypt
    'FWRY',  // Fawry
    'AMOC',  // Alexandria Mineral Oils
    'EGAL',  // Egypt Aluminum
    'PHDC',  // Palm Hills Development
    'CCAP',  // Qalaa Holdings
    'ORAS',  // Orascom Construction
    'ORHD',  // Orascom Development
    'ORWE',  // Oriental Weavers
    'SKPC',  // Sidi Kerir Petrochemicals
    'ESRS',  // Ezz Steel
    'CLHO',  // B Investments Holding
    'ISPH',  // Ibnsina Pharma
    'JUFO',  // Juhayna Food Industries
    'MNHD',  // Madinet Nasr Housing
    'MASR',  // Misr Italia Properties
    'HELI',  // Heliopolis Housing
    'CIRA',  // Cairo for Investment & Real Estate
    'EMFD',  // Emaar Misr
    'BTFH',  // Beltone Financial Holding
    'EKHO',  // Edita Food Industries
    'GBCO',  // GB Auto
    'EGAS',  // Egypt Gas
];

// Phrases that indicate user wants individual stocks of an index, not the index itself
const INDEX_TRIGGER_PHRASES = [
    /اسهم\s*(مؤشر|موشر|مأشر)\s*(التلاتين|الثلاثين|التلتين|ال30|30)/i,
    /اسهم\s*(ال|)مؤشر/i,
    /مكونات\s*(ال|)(مؤشر|موشر)/i,
    /كل\s*اسهم\s*(ال|)(مؤشر|موشر)/i,
    /(مؤشر|موشر)\s*(التلاتين|الثلاثين|التلتين|ال30|30)\s*(اسهم|أسهم)/i,
    /اسهم\s*(التلاتين|الثلاثين|التلتين)/i,
];

export async function getStocksList(): Promise<StocksListData> {
    const now = Date.now();
    if (!cachedStocks || (now - lastCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol, name, name_ar")
                .eq("exchange", "EGX")
                .eq("is_active", true);
            if (data && data.length > 0) {
                cachedStocks = data;
                lastCacheTime = now;
            }
        } catch (e) {
            console.warn("Failed to fetch stocks for planner cache", e);
        }
    }
    
    const stockMappings: Record<string, string> = { ...ARABIC_STOCK_MAPPINGS };
    for (const stock of cachedStocks || []) {
        const nameEn = stock.name?.trim();
        if (nameEn) stockMappings[nameEn] = stock.symbol.toUpperCase();
        String(stock.name_ar || "").split(/[,،|/]/).map(name => name.trim()).filter(Boolean).forEach(name => { stockMappings[name] = stock.symbol.toUpperCase(); });
    }
    let stocksListStr = "";

    if (cachedStocks && cachedStocks.length > 0) {
        stocksListStr = cachedStocks
            .map(s => `- ${s.symbol}: ${s.name}`)
            .join("\n");
    }

    return { stocksListStr, stockMappings };
}

export function getSyncStockMappings(): Record<string, string> {
    const stockMappings: Record<string, string> = { ...ARABIC_STOCK_MAPPINGS };
    for (const stock of cachedStocks || []) {
        const nameEn = stock.name?.trim();
        if (nameEn) stockMappings[nameEn] = stock.symbol.toUpperCase();
        String(stock.name_ar || "").split(/[,،|/]/).map(name => name.trim()).filter(Boolean).forEach(name => { stockMappings[name] = stock.symbol.toUpperCase(); });
    }
    return stockMappings;
}

let cachedValidSymbols: string[] = [];
let lastSymbolsCacheTime = 0;
async function loadValidSymbols(): Promise<string[]> {
    const now = Date.now();
    if (cachedValidSymbols.length === 0 || (now - lastSymbolsCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol")
                .eq("is_active", true);
            if (data && data.length > 0) {
                cachedValidSymbols = data.map((s: any) => s.symbol.toUpperCase());
                lastSymbolsCacheTime = now;
            }
        } catch (e) {
            console.warn("Failed to fetch symbols from DB for validation cache", e);
        }
    }
    
    if (cachedValidSymbols.length === 0) {
        cachedValidSymbols = STATIC_VALID_SYMBOLS;
    }
    return cachedValidSymbols;
}

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
    'SPIN', 'SWDY', 'TANM', 'TAQA', 'TMGH', 'TRTO', 'TWSA', 'TYCN', 'UEFM', 'UNIT', 'USDEGP', 'VALU', 'VLMRA', 'WATP'
];

function getLevenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function correctStockSymbol(symbol: string, validSymbols: string[]): string {
    const upperSym = symbol.trim().toUpperCase();
    if (validSymbols.includes(upperSym)) {
        return upperSym;
    }

    let bestMatch = upperSym;
    let minDistance = 2; // Maximum edit distance allowed

    for (const valid of validSymbols) {
        const dist = getLevenshteinDistance(upperSym, valid);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = valid;
        }
    }

    return bestMatch;
}

export function extractSymbolsFromText(
    text: string, 
    validSymbols: string[], 
    stockMappings: Record<string, string | string[]> = {}
): string[] {
    const textUpper = text.toUpperCase();
    const found: string[] = [];

    // Check if user is asking about index constituent stocks
    const isIndexQuery = INDEX_TRIGGER_PHRASES.some(pattern => pattern.test(text));
    if (isIndexQuery) {
        // Return all EGX30 constituent stocks that exist in our database
        const validConstituents = EGX30_CONSTITUENTS.filter(s => validSymbols.includes(s));
        found.push(...validConstituents);
        return Array.from(new Set(found));
    }

    const tokens = textUpper.split(/[^A-Z0-9]/).map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
        if (validSymbols.includes(token)) {
            found.push(token);
        } else if (token.length >= 3) {
            const corrected = correctStockSymbol(token, validSymbols);
            if (corrected && validSymbols.includes(corrected) && corrected !== token) {
                found.push(corrected);
            }
        }
    }

    const normalizedText = text
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase();

    const mergedMappings = { ...ARABIC_STOCK_MAPPINGS, ...stockMappings };
    // Use regex with Arabic/Latin word boundaries to avoid substring false positives
    for (const [key, symbolOrArr] of Object.entries(mergedMappings).sort((a, b) => b[0].length - a[0].length)) {
        const normalizedKey = key
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .toLowerCase();

        // Escape regex special characters in the key
        const escapedKey = normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?:^|[^a-z0-9\u0600-\u06ff])${escapedKey}(?:$|[^a-z0-9\u0600-\u06ff])`, "i");
        if (regex.test(normalizedText)) {
            if (Array.isArray(symbolOrArr)) {
                found.push(...symbolOrArr);
            } else {
                found.push(symbolOrArr);
            }
        }
    }

    return Array.from(new Set(found)).filter(s => validSymbols.includes(s));
}

// In-Memory Image Cache - DISABLED for better accuracy
const imageCache = new Map<string, PlannerResult>();
const ENABLE_IMAGE_CACHE = false; // 🔧 Disabled to force fresh analysis

function validateImageExtraction(summary: string | null): boolean {
    if (!summary) return false;
    const hasSymbols = /[A-Z]{3,5}/.test(summary);
    const hasNumbers = /\d+/.test(summary);
    return hasSymbols || hasNumbers;
}

export async function runPlanner(
    message: string,
    imageList: string[],
    session: SessionState,
    history: any[],
    apiKeys: string[],
    vision?: VisionContext | null
): Promise<PlannerResult> {
    const validSymbols = await loadValidSymbols();
    const visionProvided = !!vision;
    const hasImages = imageList && imageList.length > 0 && !visionProvided;

    // Image Caching Check - DISABLED for fresh analysis
    const imageKey = hasImages ? createHash("sha256").update(imageList[0]).digest("hex") : "";
    if (hasImages && imageKey && ENABLE_IMAGE_CACHE && imageCache.has(imageKey)) {
        console.log("🔄 Using cached image analysis (Cache is DISABLED by default)");
        const cached = imageCache.get(imageKey)!;
        return {
            ...cached,
            session_update: {
                current_symbol: cached.entities.symbols[0] || session.current_symbol,
                last_symbols: Array.from(new Set([...cached.entities.symbols, ...(session.last_symbols || [])])).slice(0, 15),
                summary: cached.session_update.summary
            }
        };
    }

    // Fully General & Dynamic Intent & Tool Router Prompt
    const { stocksListStr, stockMappings } = await getStocksList();
    const plannerSystemPrompt = `You are EGX Bots Master Planner for the Egyptian Stock Exchange.

${stocksListStr ? `=== ACTIVE EGX STOCKS IN DATABASE (Use this list to map Arabic or English stock queries to their exact symbols) ===
${stocksListStr}
=== END OF LIST ===` : ""}

${visionProvided ? `=== PRE-ANALYZED IMAGE CONTEXT ===
Image type: ${vision.image_type}
Symbols found: ${vision.symbols.map(s => s.symbol).join(", ") || "none"}
Summary: ${vision.user_relevant_summary || "none"}
=== END IMAGE CONTEXT ===
` : hasImages ? `**ANALYZE THE IMAGE CAREFULLY:**
CRITICAL INSTRUCTIONS:
1. Extract ALL stock symbols visible in the image - do NOT miss any symbols.
2. Look at EVERY row, cell, and section of the financial image.
3. For each stock symbol, extract the exact values, numbers, and percentages shown next to it (such as the portfolio position value, current price, change amount, and change percentage).
4. Include all of these details (symbols, prices, values, changes) in a clear table format or list inside the "image_summary" field so that the final text model can read them.
5. ⚠️ IMPORTANT: Ignore any stock symbols mentioned in 'Current Session' or 'Recent History' unless they are clearly visible in the new image itself.
6. Provide a detailed Arabic description of ALL financial content visible in the image in the "image_summary" field.

EXAMPLE: If you see 4 stocks in the image, you MUST extract all 4 symbols, and list the exact prices and values for each in the "image_summary" description.

` : ""}**AVAILABLE TOOLS:**
- "get_stock": Fetches live price, volume, change %, RSI, MACD, and SMA data for specific stock symbol(s). Use when the user asks for analysis, price, support, resistance, technical indicators, or general info about specific stock(s).
- "get_news": Fetches recent news headlines, articles, and sentiment scores. Use when the user asks for news (أخبار), announcements, or sentiment.
- "get_recommendations": Fetches algorithmic buy/sell recommendations. Use when the user explicitly asks for recommendations, buying advice, or signals (e.g. 'تنصحني', 'أشتري', 'توصيات').
- "get_sector": Fetches aggregated technical and fundamental data for a SPECIFIC market sector (e.g., 'البنوك', 'الأدوية', 'العقارات'). Do NOT use if the user asks for a list of sectors without specifying a sector name.
- "get_sector_list": Fetches the full list of available market sectors and stock counts. Use when the user asks for a list of sectors or all sectors (e.g., 'عندك كام قطاع', 'عدد القطاعات', 'إيه القطاعات المتاحة', 'قائمة القطاعات', 'قايمه بالقطاعات', 'هات قايمه بالقطاعات', 'القطاعات', 'كل القطاعات').
- "get_market": Fetches overall market summary, EGX30/EGX70 index data, and top gainers/losers. Use when the user asks about the overall market, index, or general liquidity (e.g. 'حالة السوق', 'ايه اللي طلع', 'السوق').
- "get_accumulation_stocks": Fetches a list of stocks currently in Wyckoff accumulation/distribution phases. Use when the user asks about 'تجميع', 'تصريف', 'سيولة مؤسسية', or 'accumulation'.
- "get_comparison": Fetches data to compare two or more stocks. Use when the user explicitly asks to compare stocks (e.g., 'مقارنة بين', 'أيهما أفضل').

**YOUR TASK:**
Analyze the user request and return a JSON object. You MUST dynamically choose the correct "tools" array based on the AVAILABLE TOOLS above. Combine multiple tools if necessary (e.g., ["get_stock", "get_news"] if the user asks for analysis and news).

**JSON STRUCTURE TO RETURN:**
{
  "intent": "Brief string describing intent (e.g., stock_analysis, sector_analysis, market_summary, general_chat)",
  "confidence": 0.95,
  "guidance_intent": null,
  "entities": {
    "symbols": ["SYMBOL1", "SYMBOL2"], // EXACT stock tickers in uppercase (e.g. COMI). Empty array if none.
    "sector": "Arabic Sector Name", // e.g. "بنوك", "عقارات". Null if none.
    "wants_table": false, // Set to true if user wants a table
      "scan_direction": null, // Set to "accumulation" or "distribution" if requested, else null
    "timeframe": null
  },
  "tools": ["ToolName1", "ToolName2"], // EXACT tool names selected from AVAILABLE TOOLS. [] for general_chat.
  "image_summary": null,
  "session_update": {
    "current_symbol": "SYMBOL1",
    "last_symbols": ["SYMBOL1", "SYMBOL2"],
    "summary": "Brief summary of request"
  }
}

**CRITICAL RULES:**
- If the user asks about a sector (e.g. 'قطاع الأدوية'), you MUST extract the Arabic sector name into entities.sector (e.g. 'أدوية').
- For historical recall queries ('الرقم اللي قولته قبل كده', 'التحليل اللي فات'): use intent "historical_recall" with tools [].
- For conversational/greeting queries: use intent "general_chat" with tools [].
- For beginners, savings, brokerage products, or portfolio allocation: set guidance_intent to onboarding, allocation, product_comparison, or product_explainer. Do not fetch recommendations until goals, horizon, liquidity, and risk tolerance are known.
- Thndr/ثندر is a brokerage platform in phrases like 'أستثمر في ثندر'; it is not a stock or a slang signal for explosive price movement.
- Do not select recommendation tools merely because the request says 'فرص' or 'النهارده'. Use them only for explicit recorded recommendations/signals.
- ⚠️ CRITICAL IMAGE RULE: If an image is uploaded (hasImages is true), prioritize image analysis. Extract all visible tickers into entities.symbols, set intent to "portfolio" or "chart_analysis", and set tools to ["get_stock"].
- NEVER use double quotes (") inside string values like image_summary. Use single quotes (').
- Return ONLY valid JSON, starting with '{' and ending with '}'.`;

    const hasContextReference = /الاتنين|الإثنين|الاطنين|كلاهما|مع بعض|السهمين|تحليلهم|هاتهم|قولي عنهم|حللهم|بياناتهم|سعرهم|أخبارهم|ده|دا|دي|هذا|السابق|اللي فات|قبل كده|من شوية|تاريخ الشات|سياق المحادثة/i.test(message || "");
    const recentHistoryText = (hasImages || visionProvided || !hasContextReference) ? "" : (history || []).slice(-4).map((h: any) => `${h.role}: ${h.content}`).join("\n");
    const imageInstructions = visionProvided
        ? ""
        : (hasImages
        ? `\n\n⚠️ UNRESTRICTED EXPERT VISION EXTRACTION ⚠️\n- Thoroughly inspect the uploaded image(s) using full multimodal vision capabilities.\n- If the image contains portfolio holdings, OCR and extract ALL visible uppercase stock tickers.\n- If the image contains technical charts, diagrams, or financial documents: describe every detail, pattern, technical indicator, price target, support/resistance level, and trend visible in image_summary.\n` 
        : "");
    const sessionContext = hasContextReference
        ? `Current Session:\n${JSON.stringify(session)}\n\nRecent History:\n${recentHistoryText}\n\n`
        : "";
    const userPromptText = `${sessionContext}User Request:\n${message || "Analyze input"}${imageInstructions}\n\n⚠️ CRITICAL instruction: You MUST return ONLY a valid JSON object starting with '{' and ending with '}'. Do NOT write any conversational text, explanations, or steps (like 'To analyze the image...'). Respond only with the JSON data.`;

    const plannerModels = hasImages
        ? AI_CONFIG.models.planner.vision 
        : AI_CONFIG.models.planner.text;

    // 🚀 MULTI-IMAGE HANDLER: Execute parallel single-image vision calls to bypass NVIDIA 1-image-per-prompt API limit
    if (hasImages && imageList.length > 1) {
        console.log(`🖼️ Multi-image detected (${imageList.length} images). Executing parallel single-image vision extraction...`);
        const allExtractedSymbols: string[] = [];
        const validSymbols = await loadValidSymbols();
        
        await Promise.all(imageList.map(async (imgUrl) => {
            for (const key of apiKeys) {
                for (const modelName of plannerModels) {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 25000);
                        const singleUserContent = [
                            { type: "text", text: userPromptText },
                            { type: "image_url", image_url: { url: imgUrl } }
                        ];
                        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${key}`
                            },
                            signal: controller.signal,
                            body: JSON.stringify({
                                model: modelName,
                                messages: [
                                    { role: "system", content: plannerSystemPrompt },
                                    { role: "user", content: singleUserContent }
                                ],
                                max_tokens: 1500,
                                temperature: 0.05
                            })
                        });
                        clearTimeout(timeoutId);
                        if (res.ok) {
                            const json = await res.json();
                            const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                            let parsed: any = null;
                            try { parsed = JSON.parse(rawContent); } catch {
                                const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                                if (jsonMatch) try { parsed = JSON.parse(jsonMatch[0]); } catch {}
                            }
                            if (parsed && parsed.entities && Array.isArray(parsed.entities.symbols)) {
                                parsed.entities.symbols.forEach((sym: string) => {
                                    const corr = correctStockSymbol(sym, validSymbols);
                                    if (corr && validSymbols.includes(corr)) allExtractedSymbols.push(corr);
                                });
                                return; // success for this image
                            }
                        }
                    } catch {}
                }
            }
        }));

        const finalMultiSymbols = Array.from(new Set(allExtractedSymbols));
        console.log(`🖼️ Multi-image combined symbols (${finalMultiSymbols.length}):`, finalMultiSymbols);
        return {
            intent: "portfolio",
            confidence: 0.95,
            entities: { symbols: finalMultiSymbols, sector: null, wants_table: true, timeframe: "1d" },
            tools: ["get_stock"],
            session_update: { current_symbol: finalMultiSymbols[0] || null, last_symbols: finalMultiSymbols, summary: `Multi-image analysis of ${imageList.length} images` }
        };
    }

    let userContent: any;
    if (hasImages) {
        userContent = [
            { type: "text", text: userPromptText },
            { type: "image_url", image_url: { url: imageList[0] } }
        ];
    } else {
        userContent = userPromptText;
    }

    const officialKey = process.env.DEEPSEEK_OFFICIAL_API_KEY || null;
    if (officialKey && !hasImages) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.limits.plannerTimeoutMs || 8000);
            const res = await fetch(AI_CONFIG.api.deepseekOfficialBaseUrl || "https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${officialKey}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: "deepseek-v4-flash",
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userPromptText }
                    ],
                    response_format: { type: "json_object" },
                    max_tokens: AI_CONFIG.limits.plannerMaxTokens || 320,
                    temperature: 0.05
                })
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const json = await res.json();
                const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                let parsed: any = null;
                try { parsed = JSON.parse(rawContent); } catch {
                    const match = rawContent.match(/\{[\s\S]*\}/);
                    if (match) try { parsed = JSON.parse(match[0]); } catch {}
                }
                if (parsed && parsed.intent) {
                    const validSymbols = await loadValidSymbols();
                    const { stockMappings } = await getStocksList();
                    const extracted = extractSymbolsFromText(message || "", validSymbols, stockMappings);
                    const tools = Array.isArray(parsed.tools) ? parsed.tools : ["get_stock"];

                    const normMsg = (message || "").toLowerCase();
                    const hasRecommendationKeywords = /(?:في|فى|فيه|عندك|هل\s+يوجد|موجود)?\s*(?:توصيات|توصيه|توصية|إشارة|إشارات|اشارة|اشارات|اشارات\s+النظام|إشارات\s+النظام|سجل\s+التوصيات|اقدم\s+توصيه|أقدم\s+توصية)/i.test(message || "");

                    // إذا سأل عن سهم بعبارة معلوماتية → اضمن get_stock + get_news
                    const hasStockInfoKeywords = /خبرني|حدثني|حلل|معلومات|تحليل|سعر|عامل|بكم|وضع|ايه رأيك|ايه رأي|عمل ايه|معاه ايه|ايه اللي|رسم|شارت|chart/.test(normMsg);
                    if (extracted.length > 0 && hasStockInfoKeywords) {
                        if (!tools.includes("get_stock")) tools.unshift("get_stock");
                        if (!tools.includes("get_news")) tools.push("get_news");
                    }

                    if (hasRecommendationKeywords && !hasImages) {
                        if (!tools.includes("get_recommendations")) tools.push("get_recommendations");
                        if (!tools.includes("get_signals")) tools.push("get_signals");
                    }

                    // Clean Intent Resolution: If intent is general market scan or tools include accumulation/market without explicit tickers, do not attach old symbols
                    const isMarketScan = (parsed.intent === "accumulation" || parsed.intent === "market_summary" || parsed.intent === "sector_analysis" || tools.includes("get_accumulation_stocks") || tools.includes("get_market")) && parsed.intent !== "comparison";
                    const rawSymbols = isMarketScan && extracted.length === 0 ? [] : (Array.isArray(parsed.entities?.symbols) ? parsed.entities.symbols : []);
                    const normalizedSymbols = rawSymbols.map((s: string) => correctStockSymbol(s, validSymbols)).filter((s: string) => validSymbols.includes(s));
                    const finalSymbols = (isMarketScan && extracted.length === 0 ? [] : Array.from(new Set([...extracted, ...normalizedSymbols])))
                        .filter((s: string) => /^[A-Z]{2,6}$/.test(s) && !/^\d+$/.test(s));

                    const isHistoricalRecallQuery = /التحليل (اللي فات|السابق)|الرقم اللي (قولته|ذكرته) قبل كده|السعر اللي قولته|كان (RSI|macd|السعر) كام|من شوية|قبل كده/i.test(message);
                    let finalIntent = parsed.intent || "stock_analysis";
                    if (hasRecommendationKeywords) {
                        finalIntent = "recommendations";
                    } else if (isHistoricalRecallQuery) {
                        finalIntent = "historical_recall";
                    }

                    return {
                        intent: finalIntent,
                        confidence: parsed.confidence || 0.95,
                        guidance_intent: parsed.guidance_intent || null,
                        entities: { symbols: finalSymbols, sector: parsed.entities?.sector || null, wants_table: parsed.entities?.wants_table ?? (finalSymbols.length > 0), timeframe: parsed.entities?.timeframe || "1d" },
                        tools: tools,
                        session_update: { current_symbol: finalSymbols[0] || null, last_symbols: finalSymbols, summary: parsed.session_update?.summary || "" }
                    };
                }
            }
        } catch (err) {
            console.warn("DeepSeek Official Planner fetch failed, falling back to NVIDIA keys:", err);
        }
    }

    let keyIndex = 0;
    // Planner output is a tiny JSON object. Bound provider retries so an
    // outage cannot consume the whole chat request before we fail clearly.
    let plannerAttempts = 0;
    const maxPlannerAttempts = 2;
    const maxKeysPerModel = 1;
    for (const modelName of plannerModels) {
        while (keyIndex < Math.min(apiKeys.length, maxKeysPerModel) && plannerAttempts < maxPlannerAttempts) {
            const key = apiKeys[keyIndex];
            try {
                plannerAttempts += 1;
                const controller = new AbortController();
                const timeoutMs = hasImages ? 3500 : 2500;
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const reqBody: any = {
                    model: modelName,
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userContent }
                    ],
                    max_tokens: AI_CONFIG.limits.plannerMaxTokens || 320,
                    temperature: 0.05
                };
                if (!hasImages) {
                    reqBody.response_format = { type: "json_object" };
                }

                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify(reqBody)
                });

                clearTimeout(timeoutId);

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(rawContent);
                    } catch {
                        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                parsed = JSON.parse(jsonMatch[0]);
                            } catch (parseError) {}
                        }
                    }

                    if (parsed) {
                        const fullVisionText = (rawContent || "") + " " + (parsed.image_summary || "");
                        const symbolsTextExtracted = hasImages 
                            ? extractSymbolsFromText(fullVisionText, validSymbols, stockMappings)
                            : extractSymbolsFromText(message, validSymbols, stockMappings);

                        const rawSymbols = Array.isArray(parsed.entities?.symbols) 
                            ? parsed.entities.symbols 
                            : (parsed.session_update?.current_symbol ? [parsed.session_update.current_symbol] : []);

                        const symbols = Array.from(new Set([
                            ...rawSymbols.map((s: string) => correctStockSymbol(String(s).toUpperCase(), validSymbols)),
                            ...symbolsTextExtracted
                        ]))
                        .filter((s: string) => validSymbols.includes(s) && /^[A-Z]{2,6}$/.test(s) && !/^\d+$/.test(s))
                        .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1" && s !== "PRIMARY_SYMBOL" && s !== "NULL" && s !== "UNDEFINED" && s !== "NONE");

                        const isFollowupQuery = /الاتنين|الإثنين|الاطنين|كلاهما|مع بعض|السهمين|تحليلهم|هاتهم|قولي عنهم|حللهم|بياناتهم|سعرهم|أخبارهم/i.test(message);
                        const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);
                        const isMarketScan = 
                            (parsed.intent === "market_summary" || 
                            parsed.intent === "accumulation" ||
                            parsed.intent === "sector_analysis" ||
                            (Array.isArray(parsed.tools) && (
                                parsed.tools.includes("get_market") || 
                                parsed.tools.includes("get_indices") || 
                                parsed.tools.includes("get_accumulation_stocks")
                            )) ||
                            /مين طلع ومين نزل|ايه اللي طلع وايه اللي نزل|ايه اللى طلع وايه اللى نزل|السوق عمل ايه|حالة السوق|صعود وهبوط|gainers and losers|what went up|whole market|where is liquidity|اسهم (الشهر|السهر)|(الشهر|السهر) (اللي|اللى) (فات|الماضي)|سيولة|تجميع/i.test(message))
                            && parsed.intent !== "comparison";

                        let resolvedSymbols: string[] = [];
                        if (symbols.length > 0) {
                            resolvedSymbols = symbols;
                        } else if (!isMarketScan && !hasImages) {
                            if ((isFollowupQuery || isAggregateTableRequest) && session.last_symbols?.length) {
                                resolvedSymbols = session.last_symbols;
                            }
                        }

                        let finalIntent = parsed.intent || (hasImages ? "portfolio" : "general_chat");
                        const isHistoryQuery = /سيره كام سهم|ذكرنا كام سهم|سيرة كام سهم|سياق المحادثة|تاريخ الشات|الملخص|قلنا ايه/i.test(message);
                        const isHistoricalRecallQuery = /التحليل (اللي فات|السابق)|الرقم اللي (قولته|ذكرته) قبل كده|السعر اللي قولته|كان (RSI|macd|السعر) كام|من شوية|قبل كده/i.test(message);
                        
                        const hasRecommendationKw = /(?:في|فى|فيه|عندك|هل\s+يوجد|موجود)?\s*(?:توصيات|توصيه|توصية|إشارة|إشارات|اشارة|اشارات|اشارات\s+النظام|إشارات\s+النظام|سجل\s+التوصيات|اقدم\s+توصيه|أقدم\s+توصية)/i.test(message || "");
                        if (hasRecommendationKw) {
                            finalIntent = "recommendations";
                        } else if (isHistoryQuery) {
                            finalIntent = "general_chat";
                        } else if (isHistoricalRecallQuery) {
                            finalIntent = "historical_recall";
                        } else if (resolvedSymbols.length > 0 && finalIntent === "general_chat") {
                            finalIntent = "portfolio";
                        }

                        const toolsList: string[] = finalIntent === "general_chat" 
                            ? [] 
                            : (Array.isArray(parsed.tools) ? parsed.tools : []);
                        if (resolvedSymbols.length > 0 && !toolsList.includes("get_stock") && finalIntent !== "general_chat") {
                            toolsList.unshift("get_stock");
                        }
                        if (hasRecommendationKw && !hasImages) {
                            if (!toolsList.includes("get_recommendations")) toolsList.push("get_recommendations");
                            if (!toolsList.includes("get_signals")) toolsList.push("get_signals");
                        }

                        const imageSummary = hasImages ? (parsed.image_summary || "تحليل البيانات والصورة المرفقة من المحفظة.") : null;

                        const result: PlannerResult = {
                            intent: finalIntent,
                            confidence: parsed.confidence || 0.95,
                            guidance_intent: parsed.guidance_intent || null,
                            entities: {
                                symbols: resolvedSymbols,
                                sector: parsed.entities?.sector || null,
                                wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest || hasImages) && finalIntent !== "general_chat"
                            },
                            tools: Array.from(new Set(toolsList)),
                            image_summary: imageSummary,
                            session_update: {
                                current_symbol: finalIntent === "general_chat" 
                                    ? session.current_symbol 
                                    : (parsed.session_update?.current_symbol 
                                        ? correctStockSymbol(parsed.session_update.current_symbol, validSymbols) 
                                        : resolvedSymbols[0] || session.current_symbol),
                                last_symbols: finalIntent === "general_chat"
                                    ? (session.last_symbols || [])
                                    : (hasImages 
                                        ? resolvedSymbols
                                        : (Array.isArray(parsed.session_update?.last_symbols) && parsed.session_update.last_symbols.length > 0
                                            ? parsed.session_update.last_symbols.map((s: string) => correctStockSymbol(String(s).toUpperCase(), validSymbols))
                                            : Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15))),
                                summary: message || (hasImages ? "تحليل صورة" : null)
                            }
                        };

                        if (hasImages && imageSummary && imageKey) {
                            imageCache.set(imageKey, result);
                        }

                        return result;
                    }
                    break; // Model returned OK but invalid content format - try next model
                } else {
                    console.warn(`Planner model ${modelName} failed with status ${res.status}`);
                    keyIndex++;
                    continue;
                }
            } catch (e: any) {
                console.warn(`Planner model ${modelName} attempt warning:`, e);
                keyIndex++;
            }
        }
        keyIndex = 0;
    }

    const isBestBuy = isBestBuyStockQuestion(message);
    const isMarketSlang = /مين طلع ومين نزل|ايه اللي طلع وايه اللي نزل|ايه اللى طلع وايه اللى نزل|السوق عمل ايه|حالة السوق|صعود وهبوط|gainers and losers|what went up|whole market|where is liquidity/i.test(message);
    const sectorFollowUp = /^(?:اى|أي|ايه|ما هو|ما هي|مين)\s+(?:اكبر|أكبر)\s+(?:سهم|شركة)\s+(?:في|فى|بقطاع|من)\s+(.+)$/i.exec(message.trim())
        || /^(?:اكبر|أكبر)\s+(?:سهم|شركة)\s+(?:في|فى|بقطاع|من)\s+(.+)$/i.exec(message.trim());
    const fallbackSymbols = (hasImages || isMarketSlang) ? [] : (session.last_symbols?.length ? session.last_symbols : (session.current_symbol ? [correctStockSymbol(session.current_symbol, validSymbols)] : []));

    if (isBestBuy) {
        return {
            intent: fallbackSymbols.length > 0 ? "stock_analysis" : "market_summary",
            confidence: 0.8,
            entities: { symbols: fallbackSymbols, sector: null, wants_table: true },
            tools: fallbackSymbols.length > 0 ? ["get_stock", "get_stock_levels"] : ["get_recommendations", "get_fair_value_scan"],
            session_update: {
                current_symbol: fallbackSymbols[0] || session.current_symbol,
                last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [],
                summary: message
            }
        };
    }

    return {
        intent: "general_chat",
        confidence: 0,
        entities: { symbols: [], sector: null, wants_table: false },
        tools: [],
        service_degraded_message: "تعذر عليّ فهم الطلب حالياً بسبب ضغط مؤقت في خدمة التحليل. من فضلك أعد المحاولة بعد لحظات.",
        image_summary: hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : undefined,
        session_update: { 
            current_symbol: session.current_symbol,
            last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [], 
            summary: message 
        }
    };
}
