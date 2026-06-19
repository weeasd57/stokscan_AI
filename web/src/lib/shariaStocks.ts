export const SHARIA_COMPLIANT_EGX_SYMBOLS: readonly string[] = [
  "ISPH",
  "AMOC",
  "ICFC",
  "IFAP",
  "OCDI",
  "RMDA",
  "ACGC",
  "ARCC",
  "CIRA",
  "ETRS",
  "ETEL",
  "MPCO",
  "ORWE",
  "MTIE",
  "ORAS",
  "ORHD",
  "EFIH",
  "EFID",
  "PHDC",
  "SAUD",
  "FAITA",
  "FAIT",
  "JUFO",
  "RACC",
  "SKPC",
  "OLFI",
  "EGAS",
  "LCSW",
  "TMGH",
  "MASR",
  "ATQA",
  "MCQE",
  "EGAL",
  "ADIB",
];

const SHARIA_SET = new Set(SHARIA_COMPLIANT_EGX_SYMBOLS.map((s) => s.toUpperCase()));

export function isShariaCompliant(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  const base = symbol.toUpperCase().split(".")[0];
  return SHARIA_SET.has(base);
}

export function getShariaCompliantCount(): number {
  return SHARIA_SET.size;
}
