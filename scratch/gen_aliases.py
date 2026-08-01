import os

aliases = {
    'الشمس': 'ELSH', 'التجاري': 'COMI', 'فوري': 'FWRY', 'طلعت': 'TMGH',
    'عز': 'ESRS', 'حديد عز': 'ESRS', 'بلتون': 'BTFH', 'هيرميس': 'HRHO',
    'الشرقية للدخان': 'EAST', 'ايسترن': 'EAST', 'عامر': 'AMER', 'السويدي': 'SWDY',
    'موبكو': 'MFPC', 'ابو قير': 'ABUK', 'أبو قير': 'ABUK', 'سيدي كرير': 'SKPC',
    'اموك': 'AMOC', 'أموك': 'AMOC', 'بالم هيلز': 'PHDC', 'مدينة نصر': 'MNHD',
    'مصر الجديدة': 'HELI', 'جهينة': 'JUFO', 'ايديتا': 'EFID', 'إيديتا': 'EFID',
    'ابن سينا': 'ISPH', 'سوديك': 'OCDI', 'أوراسكوم': 'ORHD', 'بايونيرز': 'PRDC',
    'دايس': 'DSCW', 'سبيد': 'SPMD', 'مستشفى كليوباترا': 'CLHO', 'كريدي اجريكول': 'CIEB',
    'ابو ظبي': 'ADIB', 'القلعة': 'CCAP', 'جي بي اوتو': 'AUTO', 'راية': 'RAYA',
    'النساجون': 'ORWE', 'مكادي': 'MCQE', 'زهراء المعادي': 'ZMID', 'كيما': 'EGCH',
    'القاهرة للدواجن': 'POUL', 'دومتي': 'DOMT', 'عبور لاند': 'OLFI', 'راميدا': 'RMDA',
    'سيرا': 'CIRA', 'ابوقير': 'ABUK'
}

map = {}
for alias, symbol in aliases.items():
    if symbol not in map:
        map[symbol] = []
    map[symbol].append(alias)

with open('scratch/update_aliases.sql', 'w', encoding='utf-8') as f:
    for symbol, names in map.items():
        names_str = ', '.join(names)
        f.write(f"UPDATE stock_fundamentals SET name_ar = '{names_str}' WHERE symbol = '{symbol}' AND name_ar IS NULL;\n")

print(f"Generated SQL for {len(map)} symbols.")
