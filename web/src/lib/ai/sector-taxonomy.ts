export interface SectorDefinition {
    name: string;
    aliases: string[];
    classificationTerms: string[];
}

export function normalizeSectorText(value: string): string {
    return value
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
}

export const SECTOR_DEFINITIONS: SectorDefinition[] = [
    { name: "أدوية", aliases: ["ادويه", "دواء", "pharma", "pharmaceutical"], classificationTerms: ["pharma", "pharmaceutical", "drug", "health technology"] },
    { name: "رعاية صحية", aliases: ["رعايه صحيه", "خدمات طبيه", "مستشفيات", "health services"], classificationTerms: ["health services", "medical", "hospital", "رعايه صحيه", "خدمات طبيه"] },
    { name: "بنوك", aliases: ["بنوك", "مصارف", "bank", "banking"], classificationTerms: ["bank", "banking", "بنوك", "مصارف"] },
    { name: "خدمات مالية", aliases: ["خدمات ماليه", "تمويل", "مالي غير مصرفي", "finance", "financial"], classificationTerms: ["finance", "financial", "financing", "خدمات ماليه", "تمويل"] },
    { name: "عقارات", aliases: ["عقارات", "عقاري", "real estate"], classificationTerms: ["real estate", "realestate", "homebuilding", "housing", "property", "consumer durables", "عقارات", "عقاري"] },
    { name: "أغذية", aliases: ["اغذيه", "غذائي", "اطعمه", "مشروبات", "food", "beverage"], classificationTerms: ["food", "beverage", "consumer non-durables", "اغذيه", "غذائي", "مشروبات"] },
    { name: "مخابز ومطاحن", aliases: ["مخابز", "مطاحن", "دقيق", "bakery", "milling"], classificationTerms: ["milling", "mills", "flour", "bakery", "bakeries", "مطاحن", "مخابز", "دقيق"] },
    { name: "اتصالات", aliases: ["اتصالات", "اعلام", "telecom", "communications"], classificationTerms: ["telecom", "telecommunications", "communications", "اتصالات", "اعلام"] },
    { name: "تكنولوجيا", aliases: ["تكنولوجيا", "تقنيه", "برمجيات", "technology", "software"], classificationTerms: ["technology services", "electronic technology", "software", "information technology", "تكنولوجيا", "تقنيه", "برمجيات"] },
    { name: "بترول وطاقة", aliases: ["بترول", "طاقه", "نفط", "غاز", "بتروكيماويات", "كيماويات", "oil", "energy", "petrochemicals"], classificationTerms: ["oil", "gas", "petroleum", "energy minerals", "energy", "petrochemical", "chemicals", "بترول", "طاقه", "نفط", "غاز", "بتروكيماويات", "كيماويات"] },
    { name: "مواد بناء وتعدين", aliases: ["مواد بناء", "تعدين", "اسمنت", "حديد", "صلب", "معادن", "construction materials", "mining"], classificationTerms: ["non-energy minerals", "building materials", "mining", "cement", "steel", "مواد بناء", "تعدين", "اسمنت", "حديد"] },
    { name: "مقاولات وخدمات تجارية", aliases: ["مقاولات", "خدمات تجاريه", "commercial services", "contracting"], classificationTerms: ["commercial services", "contracting", "construction", "مقاولات", "خدمات تجاريه"] },
    { name: "صناعة وتصنيع", aliases: ["صناعه", "تصنيع", "صناعات", "manufacturing", "industries"], classificationTerms: ["producer manufacturing", "process industries", "industrial services", "manufacturing", "صناعه", "تصنيع"] },
    { name: "سياحة وخدمات استهلاكية", aliases: ["سياحه", "فنادق", "خدمات استهلاكيه", "tourism", "hotels"], classificationTerms: ["consumer services", "tourism", "travel", "hotel", "سياحه", "فنادق"] },
    { name: "نقل وشحن", aliases: ["نقل", "شحن", "لوجستيات", "transportation", "logistics"], classificationTerms: ["transportation", "shipping", "logistics", "نقل", "شحن", "لوجستيات"] },
    { name: "خدمات توزيع", aliases: ["خدمات توزيع", "توزيع", "distribution services"], classificationTerms: ["distribution services", "distribution", "خدمات توزيع"] },
    { name: "تجارة تجزئة", aliases: ["تجاره تجزئه", "تجزئه", "retail"], classificationTerms: ["retail trade", "retail", "تجاره تجزئه", "تجزئه"] },
    { name: "مرافق", aliases: ["مرافق", "كهرباء", "مياه", "utilities"], classificationTerms: ["utilities", "electric", "water", "مرافق", "كهرباء", "مياه"] },
    { name: "سلع معمرة", aliases: ["سلع معمره", "consumer durables"], classificationTerms: ["consumer durables", "سلع معمره"] },
    { name: "استصلاح أراضي وزراعة", aliases: ["استصلاح", "زراعه", "زراعي", "اراضي", "agriculture"], classificationTerms: ["reclamation", "agriculture", "agricultural", "farming", "crop", "استصلاح", "زراعه", "زراعي"] }
];

export function extractExcludedSectorNames(message: string): string[] {
    const normalized = normalizeSectorText(message);
    const exclusionPart = normalized.match(/(?:غير|ما\s*عدا|باستثناء|بعيد\s+عن|ابعد(?:\s+عن)?|خارج)\s+(?:قطاع(?:ات)?\s+)?(.+)$/i)?.[1];
    if (!exclusionPart) return [];

    return SECTOR_DEFINITIONS
        .filter(definition => definition.aliases.some(alias => exclusionPart.includes(normalizeSectorText(alias))))
        .map(definition => definition.name);
}

export function extractMentionedSectorNames(message: string): string[] {
    const normalized = normalizeSectorText(message);
    return SECTOR_DEFINITIONS
        .filter(definition => definition.aliases.some(alias => normalized.includes(normalizeSectorText(alias))))
        .map(definition => definition.name);
}

export function classificationMatchesSector(classification: unknown, sectorName: string): boolean {
    const normalizedClassification = normalizeSectorText(String(classification || ""));
    const normalizedName = normalizeSectorText(sectorName).replace(/^ال/, "");
    const definition = SECTOR_DEFINITIONS.find(item =>
        normalizeSectorText(item.name) === normalizeSectorText(sectorName)
        || item.aliases.some(alias => normalizeSectorText(alias) === normalizedName)
    );
    const terms = definition?.classificationTerms || [normalizedName];
    return terms.some(term => normalizedClassification.includes(normalizeSectorText(term)));
}
