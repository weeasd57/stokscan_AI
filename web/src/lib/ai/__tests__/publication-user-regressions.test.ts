import {executeAgenticTool} from '../agentic-tools';
import {checkAgenticDraft,checkUserPositionInputs,toAgenticEvidence} from '../agentic-publication';
import {groundedReviewerIssues} from '../agentic-runtime';
jest.mock('../server-secrets',()=>({getDeepSeekApiKey:()=> 'offline-key'}));
function db(rows:any[]=[]) {
    const ops:any[]=[];
    const chain:any=new Proxy({}, {get:(_,key)=>key==='then' ? (yes:any)=>Promise.resolve({data:rows,error:null}).then(yes) : (...args:any[])=>{ops.push([key,...args]);return chain;}});
    return {client:{from:(table:string)=>{ops.push(['from',table]);return chain;}},ops};
}
test.each([
    ['MASR',7.86,6.82,8.88,'-13.23%','+12.98%'],
    ['EAST',28.21,27.91,35.43,'-1.06%','+25.60%']
])('%s vertical table binds price and directional distance separately',(symbol,close,support,resistance,below,above)=>{
    const e=toAgenticEvidence('get_stock_levels',{symbols:[symbol]},{levels:[{symbol,close,support,resistance,date:'2026-10-07'}]});
    const draft=`**${symbol}**\n| البند | القيمة | المسافة من الإغلاق |\n|---|---:|---:|\n| الإغلاق | ${close} | — |\n| أقرب دعم | ${support} | ${below} |\n| أقرب مقاومة | ${resistance} | ${above} |`;
    expect(checkAgenticDraft(draft,[e])).toEqual([]);
    expect(checkAgenticDraft(draft.replace(String(below),'-30%'),[e])).toContain(`table_value_not_grounded:${symbol}:-30`);
    expect(checkAgenticDraft(draft.replace(`| ${support} |`,`| ${close} |`),[e])).toContain(`table_value_not_grounded:${symbol}:${close}`);
    expect(checkAgenticDraft(draft.replace(String(below),String(below).replace('-','+')),[e]).length).toBeGreaterThan(0);
    const descriptive=draft.replace('المسافة من الإغلاق','الموقع بالنسبة للإغلاق').replace(String(below),`أدنى من الإغلاق بنحو ${Math.abs(Number(String(below).replace('%',''))).toFixed(1)}%`);
    expect(checkAgenticDraft(descriptive,[e])).toEqual([]);
});
test('FWRY temporary valuation grounds supplied inputs and arithmetic without writes',async()=>{
    const d=db([{date:'2026-10-07',close:19.06}]);
    const args={symbol:'FWRY',quantity:17,entry_price:14.8};
    const data=await executeAgenticTool('calculate_position',args,d.client,'u');
    expect(data).toMatchObject({persisted:false,valuation_complete:true,positions:[{quantity:17,cost:251.6,market_value:324.02,profit_loss_val:72.42,profit_loss_pct:28.78}]});
    expect(d.ops).toContainEqual(['select','date,close']);expect(d.ops).toContainEqual(['limit',1]);
    expect(d.ops.filter(op=>['insert','update','delete','upsert'].includes(op[0]))).toEqual([]);
    const e=toAgenticEvidence('calculate_position',args,data);
    const draft='**FWRY**\n| البند | القيمة |\n|---|---:|\n| عدد الأسهم | 17 |\n| متوسط الشراء | 14.80 ج |\n| تكلفة المركز | 251.60 ج |\n| قيمة المركز على آخر إغلاق | 324.02 ج |\n| الربح بالجنيه | +72.42 ج |\n| الربح % | +28.78% |';
    const request='معايا 17 سهم فوري بمتوسط شراء 14.80 جنيه. احسب من غير حفظ';
    expect(checkAgenticDraft(draft,[e],request)).toEqual([]);
    expect(checkAgenticDraft(draft.replace('324.02','999.00'),[e],request)).toContain('table_value_not_grounded:FWRY:999');
    expect(checkUserPositionInputs('17 سهم',request)).toContain('user_position_average_omitted:14.80');
    expect(checkUserPositionInputs('17 سهم متوسط الشراء 14.8',request)).toEqual([]);
    const older=toAgenticEvidence('manage_portfolio',{operation:'view'},{positions:[{symbol:'MASR',quantity:100}],summary:{positions_count:1}});
    expect(checkAgenticDraft(draft,[older,e],request)).toEqual([]);
    expect(checkAgenticDraft(draft,[e],request.replace('17 سهم','18 سهم'))).toContain('position_quantity_differs_from_request');
    expect(checkAgenticDraft(draft.replace('+28.78%','+72.42%'),[e],request)).toContain('table_value_not_grounded:FWRY:72.42');
    expect(checkAgenticDraft(draft.replace('14.80 ج','251.60 ج'),[e],request)).toContain('table_value_not_grounded:FWRY:251.6');
});
test('missing quote retains cost but cannot fabricate valuation or profit',async()=>{
    const d=db();
    const data=await executeAgenticTool('calculate_position',{symbol:'FWRY',quantity:17,entry_price:14.8},d.client,'u');
    expect(data).toMatchObject({persisted:false,valuation_complete:false,positions:[{cost:251.6,close:null,market_value:null,profit_loss_val:null,profit_loss_pct:null}]});
    const e=toAgenticEvidence('calculate_position',{},data);expect(e.availability).toBe('partial');
    expect(checkAgenticDraft('FWRY\n| البند | القيمة |\n|---|---|\n| الربح | 0 |',[e]).length).toBeGreaterThan(0);
    expect(await executeAgenticTool('calculate_position',{symbol:'FWRY',quantity:0,entry_price:14.8},d.client,'u')).toMatchObject({status:'error',persisted:false});
});
test('reviewer objections require an actual draft quotation; omissions remain reviewable',()=>{
    const draft='EAST\n| الدعم | 27.91 |\n| المقاومة | 35.43 |';
    expect(()=>groundedReviewerIssues({passed:false,issues:[{message:'يعرض وقفاً غير مطلوب',kind:'claim',draft_quote:'stop_loss: 26.5'}]},draft)).toThrow('REVIEW_QUOTE_NOT_IN_DRAFT');
    expect(groundedReviewerIssues({passed:false,issues:[{message:'مقاومة خاطئة',kind:'claim',draft_quote:'المقاومة | 35.43'}]},draft)).toEqual(['مقاومة خاطئة']);
    expect(groundedReviewerIssues({passed:false,issues:[{message:'تاريخ الخبر غائب',kind:'omission',draft_quote:null}]},draft)).toEqual(['تاريخ الخبر غائب']);
});

test('interpretations cannot reverse level distances or invent a momentum trend from one snapshot',()=>{
    const e=toAgenticEvidence('get_stock_levels',{}, {levels:[{symbol:'MASR',close:7.86,support:6.82,resistance:8.88,date:'2026-10-07',macd_histogram:0.0324}]});
    expect(checkAgenticDraft('MASR\nالمسافة للمقاومة (≈13%) أكبر قليلاً من المسافة للدعم (≈13%).',[e])).toContain('level_distance_ranking_contradiction:MASR');
    expect(checkAgenticDraft('MASR\nالمقاومة أقرب من الدعم؛ الزخم يتحسن بشكل طفيف (هيستوجرام موجب).',[e])).toContain('temporal_momentum_without_series:MASR');
    expect(checkAgenticDraft('MASR\nالمقاومة أقرب من الدعم. لا يثبت أن الزخم يتحسن من لقطة واحدة.',[e])).toEqual([]);
    expect(checkAgenticDraft('MASR\nضغط البيع يتراجع نسبياً في هذه اللقطة.',[e])).toContain('temporal_momentum_without_series:MASR');
    expect(checkAgenticDraft('MASR\nالدعم أقل من المقاومة؛ المقاومة ليست أبعد من الدعم.',[e])).toEqual([]);
    const earlier=toAgenticEvidence('get_stock',{}, {stocks:[{symbol:'MASR',date:'2026-10-06',macd_histogram:0.01}]});
    expect(checkAgenticDraft('MASR\nالزخم يتحسن.',[earlier,e])).toEqual([]);
    expect(checkAgenticDraft('MASR\nالزخم يتراجع.',[earlier,e])).toContain('temporal_momentum_direction_contradiction:MASR');
});
