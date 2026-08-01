import { extractSymbolsFromText, correctStockSymbol } from './planner.ts';

const text = "هل فى تجميع على elsh";
const validSymbols = [
    'AALR', 'ABUK', 'ACAMD', 'ACAP', 'ADCI', 'ADPC', 'AFMC', 'AIH', 'AIIH', 'AJWA', 'ALCN', 'ALUM', 'AMES', 'AMOC',
    'APPC', 'ARAB', 'AREH', 'ARVA', 'ATQA', 'AXPH', 'BIOC', 'BTFH', 'CCAP', 'CIEB', 'CIRA', 'CLHO',
    'CNFN', 'COMI', 'COPR', 'CPCI', 'CRST', 'DMTY', 'EAST', 'EEII', 'EFID', 'EFIH', 'EGAL', 'EGAS', 'EGBE',
    'EGCH', 'EGREF', 'EGSA', 'EGTS', 'EGX30', 'EGX70', 'EGX100', 'EHDR', 'EITP', 'EKHO', 'ELKA', 'ELSH', 'EMFD', 'EOSB',
    'ESRS', 'ETEL', 'ETRS', 'FAIT', 'FERC', 'FTNS', 'FWRY', 'GBCO', 'GDWA', 'GGCC', 'GGRN', 'GMCI', 'GOUR',
    'GSSC', 'HELI', 'HRHO', 'ICFC', 'IDRE', 'INFI', 'IRON', 'ISMA', 'ISPH', 'JUFO', 'KABO', 'KASABF',
    'KRDI', 'KWIN', 'KZPC', 'LUTS', 'MASR', 'MBSC', 'MCQE', 'MENA', 'MFPC', 'MFSC', 'MICH', 'MILS', 'MNHD',
    'MOIL', 'MOSC', 'MPCO', 'MTIE', 'NCGC', 'NEDA', 'NHPS', 'NINH', 'NIPH', 'OLFI', 'ORAS', 'ORHD', 'ORWE', 'PHDC', 'PHTV',
    'POUL', 'PRDC', 'RACC', 'RREI', 'RTVC', 'RUBX', 'SAUD', 'SCEM', 'SCTS', 'SEIG', 'SIPC', 'SKPC', 'SNFC', 'SODIC',
    'SPIN', 'SWDY', 'TANM', 'TAQA', 'TMGH', 'TRTO', 'TWSA', 'TYCN', 'UEFM', 'UNIT', 'USDEGP', 'VALU', 'VLMRA', 'WATP'
];

const syms = extractSymbolsFromText(text, validSymbols, {});
console.log("Extracted symbols:", syms);
