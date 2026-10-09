import {stockStrategyFollowups} from "../strategy-followups";
const stock=(symbol:string)=>({tool:"get_stock",symbols:[symbol],availability:"available",data:{stocks:[{symbol,close:152}]}});
test("analysis suggestions bind every submitted question to the analyzed symbol",()=>{
    const questions=stockStrategyFollowups([stock("AFMC")],true)!;
    expect(questions).toHaveLength(3);expect(questions.every(q=>q.includes("AFMC"))).toBe(true);
    expect(questions[0]).toContain("نسبة النجاح والعائد التراكمي");expect(questions[1]).toContain("قارن");expect(questions[2]).toContain("60 جلسة");
    expect(stockStrategyFollowups([stock("TMGH")],true)!.every(q=>q.includes("TMGH") && !q.includes("AFMC"))).toBe(true);
});
test("missing, unaccepted and multiple-stock results never choose an arbitrary target",()=>{
    expect(stockStrategyFollowups([stock("AFMC")],false)).toBeUndefined();
    expect(stockStrategyFollowups([{...stock("AFMC"),availability:"missing"}],true)).toBeUndefined();
    expect(stockStrategyFollowups([stock("AFMC"),stock("COMI")],true)).toBeUndefined();
    expect(stockStrategyFollowups([],true)).toBeUndefined();
    expect(stockStrategyFollowups([{...stock("AFMC"),symbols:["AFMC","COMI"]}],true)).toBeUndefined();
});
test("levels-only replies and deduplicated analysis use the same stock",()=>{
    const levels={tool:"get_stock_levels",symbols:["AFMC"],availability:"available",data:{levels:[{symbol:"AFMC",close:152}]}};
    expect(stockStrategyFollowups([levels],true)).toEqual(stockStrategyFollowups([stock("AFMC"),levels],true));
});
