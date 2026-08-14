export interface OtcStockInfo {
    symbol: string;
    name_ar: string;
    reason_ar: string;
}

export const OTC_STOCKS_REGISTRY: Record<string, OtcStockInfo> = {
    "AMII": {
        symbol: "AMII",
        name_ar: "العربية للمحابس",
        reason_ar: "يتداول السهم في سوق خارج المقصورة (سوق الأوامر OTC) بالبورصة المصرية، ولذلك لا تتغير بيانات تداوله بانتظام على شاشة التداول اللحظية ولا تتوفر له مستويات دعم ومقاومة يومية تلقائية."
    },
    "ISMA": {
        symbol: "ISMA",
        name_ar: "الإسماعيلية الوطنية للصناعات الغذائية",
        reason_ar: "ينتمي السهم لسوق الأسهم غير المقيدة / خارج المقصورة (OTC)، حيث تكون التداولات بنظام الأوامر الخاصة وغير المقيدة بالجلسة الرئيسية."
    },
    "AFAK": {
        symbol: "AFAK",
        name_ar: "أفاك للإستثمار العقاري",
        reason_ar: "السهم غير مقيد في السوق الرئيسي وتداولاته تتم عبر سوق خارج المقصورة (OTC)."
    },
    "SNFC": {
        symbol: "SNFC",
        name_ar: "الشرقية الوطنية للأمن الغذائي",
        reason_ar: "سهم متداول بسوق الأوامر / خارج المقصورة، وبياناته الفنية اللحظية غير منقولة على الشاشات الرئيسية."
    },
    "VERT": {
        symbol: "VERT",
        name_ar: "فيرتيكا للوساطة",
        reason_ar: "يتداول في سوق خارج المقصورة (OTC)."
    },
    "MBSC": {
        symbol: "MBSC",
        name_ar: "مصر بني سويف للأسمنت",
        reason_ar: "تم نقل تداولات الشركة لسوق خارج المقصورة / الأوامر وفق القرارات التنظيمية."
    },
    "SUCE": {
        symbol: "SUCE",
        name_ar: "سويس للأسمنت",
        reason_ar: "يتداول ضمن سوق خارج المقصورة."
    },
    "EBAP": {
        symbol: "EBAP",
        name_ar: "المصرية لصناعة النشا والجلوكوز",
        reason_ar: "سهم مشطوب/متداول خارج المقصورة."
    }
};

export function isOtcStock(symbol: string): boolean {
    if (!symbol) return false;
    const cleanSym = symbol.trim().toUpperCase();
    return Boolean(OTC_STOCKS_REGISTRY[cleanSym]);
}

export function getOtcStockInfo(symbol: string): OtcStockInfo | null {
    if (!symbol) return null;
    const cleanSym = symbol.trim().toUpperCase();
    return OTC_STOCKS_REGISTRY[cleanSym] || null;
}

export function buildOtcNotice(symbol: string): string {
    const info = getOtcStockInfo(symbol);
    if (info) {
        return `⚠️ **تنبيه خاص بسوق التداول:** سهم **${info.name_ar} (${info.symbol})** ${info.reason_ar}`;
    }
    return `⚠️ **تنبيه خاص بسوق التداول:** سهم **${symbol.toUpperCase()}** ينتمي لأسهم سوق خارج المقصورة (OTC) / سوق الأوامر غير المقيدة بالجلسة الرئيسية، ولذلك لا تتوفر له بيانات فنية لحظية أو مستويات دعم ومقاومة يومية منقولة بانتظام في قاعدة بيانات النظام.`;
}
