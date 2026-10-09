/** Presentation suggestions from this reply's verified tool evidence, not intent routing. */
export function stockStrategyFollowups(results: any[], accepted: boolean): string[] | undefined {
    if (!accepted || !Array.isArray(results)) return;
    const valid=results.filter(r=>r && !["error","missing"].includes(r.availability) && r.data?.status !== "error");
    const rows=(data:any):any[]=>Array.isArray(data?.stocks) ? data.stocks : Array.isArray(data?.levels) ? data.levels : data?.symbol ? [data] : [];
    const analyzed=valid.filter(r=>["get_stock","get_stock_levels"].includes(r.tool)).flatMap(r=>rows(r.data))
        .filter(r=>Number.isFinite(Number(r.close ?? r.current_price)) && Number(r.close ?? r.current_price)>0);
    const symbols=new Set(analyzed.map(r=>String(r.symbol || "").toUpperCase()));
    if (symbols.size !== 1) return;
    const symbol=[...symbols][0];
    if (!/^[A-Z0-9.]{2,12}$/.test(symbol)) return;
    const scoped=valid.flatMap(r=>Array.isArray(r.symbols) ? r.symbols : r.arguments?.symbols || (r.arguments?.symbol ? [r.arguments.symbol] : []));
    if (scoped.some(s=>String(s).toUpperCase() !== symbol)) return;
    return [
        `اختبر الاتجاه وMACD على ${symbol} واعرض نسبة النجاح والعائد التراكمي`,
        `قارن الاستراتيجيات القابلة للاختبار على ${symbol}`,
        `اختبر الاتجاه وMACD على ${symbol} خلال آخر 60 جلسة`,
    ];
}
