import {executeAgenticTool} from '../agentic-tools';
import {checkAgenticDraft,checkUserPositionInputs,toAgenticEvidence,compactEvidence} from '../agentic-publication';
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
test('known total cost needs only quantity to complete a temporary position',async()=>{
    const d=db([{date:'2026-10-07',close:877.02}]);
    const costOnly=await executeAgenticTool('calculate_position',{symbol:'ORAS',total_cost:12000},d.client,'u');
    expect(costOnly).toMatchObject({persisted:false,valuation_complete:false,positions:[{quantity:null,entry_price:null,cost:12000,close:877.02,market_value:null}]});
    const complete=await executeAgenticTool('calculate_position',{symbol:'ORAS',quantity:12,total_cost:12000},d.client,'u');
    expect(complete).toMatchObject({positions:[{quantity:12,entry_price:1000,cost:12000,market_value:10524.24,profit_loss_val:-1475.76}]});
    const fromAverage=await executeAgenticTool('calculate_position',{symbol:'ORAS',entry_price:1000,total_cost:12000},d.client,'u');
    expect(fromAverage.positions).toEqual(complete.positions);
    expect(checkUserPositionInputs('التكلفة 12 ألف، ابعت متوسط الشراء والكمية', 'معايا أسهم بتكلفة إجمالية 12 ألف من غير كمية أو متوسط شراء')).toContain('unneeded_average_requested_when_total_cost_known');
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
    const rsi=toAgenticEvidence('get_stock',{}, {stocks:[{symbol:'MFPC',date:'2026-10-07',rsi_14:35.39}]});
    expect(checkAgenticDraft('MFPC\nRSI عند 35.39 أقرب إلى تخفيف ضغط البيع.',[rsi])).toContain('rsi_snapshot_does_not_prove_trend:MFPC');
    const comparison=toAgenticEvidence('get_comparison',{}, {comparison:[{symbol:'EFID',date:'2026-10-07',rsi_14:31.79},{symbol:'JUFO',date:'2026-10-07',rsi_14:30.54}]});
    expect(checkAgenticDraft('كلا السهمين في منطقة قريبة من تخفيف ضغط البيع (RSI قرب 30).',[comparison])).toEqual(expect.arrayContaining(['rsi_snapshot_does_not_prove_trend:EFID','rsi_snapshot_does_not_prove_trend:JUFO']));
    expect(checkAgenticDraft('كلا السهمين قرب 30 على RSI؛ لا يثبت تخفيف ضغط البيع.',[comparison])).toEqual([]);
    expect(checkAgenticDraft('MASR\nالدعم أقل من المقاومة؛ المقاومة ليست أبعد من الدعم.',[e])).toEqual([]);
    const earlier=toAgenticEvidence('get_stock',{}, {stocks:[{symbol:'MASR',date:'2026-10-06',macd_histogram:0.01}]});
    expect(checkAgenticDraft('MASR\nالزخم يتحسن.',[earlier,e])).toEqual([]);
    expect(checkAgenticDraft('MASR\nالزخم يتراجع.',[earlier,e])).toContain('temporal_momentum_direction_contradiction:MASR');
});
test('an aggregate headline date cannot become a publication date',()=>{
    const e=toAgenticEvidence('get_news',{symbols:['COMI']},{news:[{symbol:'COMI',date:'2026-10-08',record_date:'2026-10-08',date_kind:'aggregation',event_date:null,headlines:['CIB يوقع اتفاقية استثمار']}]});
    expect(e.data_time).toBeNull();
    const old=toAgenticEvidence('get_news',{}, {news:[{symbol:'COMI',date:'2026-10-08',event_date:'2026-10-08',headlines:['CIB يوقع اتفاقية استثمار']}]});
    expect(compactEvidence(old).data.news[0]).toMatchObject({event_date:null,record_date:'2026-10-08',date_kind:'aggregation'});
    expect(checkAgenticDraft('أحدث خبر عن COMI بتاريخ 2026-10-08 هو اتفاقية استثمار.',[e])).toContain('news_record_date_is_not_publication_date');
    expect(checkAgenticDraft('COMI: العنوان موجود في سجل تجميع بتاريخ 2026-10-08؛ تاريخ النشر غير موثق.',[e])).toEqual([]);
});

const replay = require('./fixtures/oct10-user-three-questions.json');
const screenReplay = () => toAgenticEvidence('screen_stocks',{}, {status:'success',date:'2026-10-07',
    methodology:'distance=(resistance-close)/close*100',stocks:[
        {symbol:'EOSB',date:'2026-10-07',close:1.64,resistance:1.64,distance_from_resistance_pct:0,r_vol:1.5385},
        {symbol:'ORAS',date:'2026-10-07',close:877.02,resistance:894,distance_from_resistance_pct:1.94,r_vol:2.4427},
        {symbol:'FWRY',date:'2026-10-07',close:19.06,resistance:19.44,distance_from_resistance_pct:1.99,r_vol:3.0732}]});
test('actual cost-only clarification is not a market-price claim',()=>{
    const request='معايا أوراسكوم ORAS بتكلفة إجمالية ١٢ ألف جنيه، ومش عارف متوسط الشراء. إيه أقل معلومة ناقصة؟';
    expect(checkAgenticDraft(replay.cost,[],request)).toEqual([]);
    const quote=toAgenticEvidence('get_stock',{}, {stocks:[{symbol:'ORAS',date:'2026-10-07',close:877.02}]});
    expect(checkAgenticDraft('ORAS: التكلفة الإجمالية 12,000 جنيه. آخر إغلاق بسعر 877.02 جنيه. ابعت الكمية فقط.',[quote],request)).toEqual([]);
    expect(checkAgenticDraft('ORAS: سعر الإغلاق 12000 جنيه.',[quote],request).length).toBeGreaterThan(0);
    expect(checkAgenticDraft('ORAS: التكلفة الإجمالية 13000 جنيه.',[quote],request).length).toBeGreaterThan(0);
    expect(checkAgenticDraft('ORAS: التكلفة الإجمالية 12000 جنيه تعني كمية أقل من 14 سهم عند إغلاق اليوم.',[quote],request)).toContain('historical_cost_does_not_determine_quantity_at_current_close');
});
test('actual combined comparison catches temporal and baseline claims plus old news provenance',()=>{
    const evidence=replay.evidence.map((e:any)=>toAgenticEvidence(e.tool,e.arguments,e.data));
    const reasons=checkAgenticDraft(replay.comparison,evidence);
    expect(reasons).toEqual(expect.arrayContaining(['temporal_momentum_without_series:EFID','relative_volume_baseline_contradiction:JUFO','news_record_date_is_not_publication_date']));
    const corrected='MFPC وEFID وJUFO: لقطة واحدة لا تثبت تحسن الزخم أو تراجع ضغط البيع.\nJUFO نشاطه أعلى من متوسط السهم.\nأخبار COMI موجودة في سجل تجميع بتاريخ 2026-10-08؛ تاريخ نشر العناوين غير متحقق.';
    expect(checkAgenticDraft(corrected,evidence)).toEqual([]);
});
test('real numeric distance formulas verify operands, denominator and conversion separately',()=>{
    const e=screenReplay();
    const draft=replay.screen.replace('لكن هذا ليس قاعدة عامة؛ لأن معامل التحويل بين المقامين يختلف من سهم لآخر (نسبة المقاومة إلى الإغلاق مختلفة)، فلو تقاربت المسافات بين سهمين قد ينقلب ترتيبهما عند تغيير المقام. هنا الفروق واضحة بما يكفي (0.00% ثم ~1.9% ثم ~2.0%) فيبقى الترتيب ثابتا.', 'الترتيب ثابت هنا لأن التحويل بين النسب متزايد رياضياً للسعر الموجب والمقاومة فوقه أو عنده.');
    expect(checkAgenticDraft(draft,[e])).toEqual([]);
    expect(checkAgenticDraft(draft.replace('× 100','× 1000'),[e])).toContain('table_distance_formula_not_grounded:EOSB');
    expect(checkAgenticDraft(draft.replace('= 1.90%','= 1.94%'),[e])).toContain('table_distance_formula_not_grounded:ORAS');
    expect(checkAgenticDraft(draft.replace('| ORAS | 1.94% |','| ORAS | 1.90% |'),[e])).toContain('table_value_not_grounded:ORAS:1.9');
    expect(checkAgenticDraft(replay.screen,[e])).toContain('screen_distance_order_monotonicity_contradiction');
});

test('production zero-distance ties allow both formulas and negated order changes',()=>{
    const e=toAgenticEvidence('screen_stocks',{}, {status:'success',date:'2026-10-07',methodology:'distance=(resistance-close)/close*100',stocks:[
        {symbol:'TWSA',date:'2026-10-07',close:8.62,resistance:8.62,distance_from_resistance_pct:0},
        {symbol:'FAITA',date:'2026-10-07',close:1.009,resistance:1.009,distance_from_resistance_pct:0},
        {symbol:'EOSB',date:'2026-10-07',close:1.64,resistance:1.64,distance_from_resistance_pct:0}]});
    const draft='| # | السهم | الإغلاق | المقاومة | المسافة (÷ الإغلاق) | المعادلة |\n|---|---|---|---|---|---|\n| 1 | TWSA | 8.62 | 8.62 | 0.00% | (8.62 − 8.62) ÷ 8.62 × 100 |\n| 2 | FAITA | 1.009 | 1.009 | 0.00% | (1.009 − 1.009) ÷ 1.009 × 100 |\n| 3 | EOSB | 1.64 | 1.64 | 0.00% | (1.64 − 1.64) ÷ 1.64 × 100 |\nالقسمة على الإغلاق تعطي (المقاومة − الإغلاق) ÷ الإغلاق، والقسمة على المقاومة تعطي (المقاومة − الإغلاق) ÷ المقاومة.\nالترتيب لا يتغير، والقيم هنا متساوية بصفر في الحالتين.';
    expect(checkAgenticDraft(draft,[e])).toEqual([]);
    expect(checkAgenticDraft(draft.replace('الترتيب لا يتغير','الترتيب يتغير'),[e])).toContain('screen_distance_order_monotonicity_contradiction');
    expect(checkAgenticDraft(draft.replace('| 0.00% |','| 1.00% |'),[e])).toContain('table_value_not_grounded:TWSA:1');
});
test('oversold proximity and internal news fields are checked in published prose',()=>{
    const e=toAgenticEvidence('get_comparison',{}, {comparison:[{symbol:'EFID',date:'2026-10-07',rsi_14:31.79},{symbol:'JUFO',date:'2026-10-07',rsi_14:30.54}]});
    expect(checkAgenticDraft('EFID: RSI عند 31.79 (الأقرب للتشبع البيعي بين الثلاثة).',[e])).toContain('rsi_oversold_proximity_ranking_contradiction:EFID');
    expect(checkAgenticDraft('JUFO هو الأقرب للتشبع البيعي.',[e])).toEqual([]);
    expect(checkAgenticDraft('تاريخ السجل ليس نشر الخبر (date_kind = aggregation، event_date فارغ).',[])).toContain('internal_implementation_names_in_response');
});

test('separate symbolic denominator explanations are checked independently',()=>{
    const e=screenReplay();
    const draft='القسمة على الإغلاق: (المقاومة − الإغلاق) ÷ الإغلاق.\nالقسمة على المقاومة: (المقاومة − الإغلاق) ÷ المقاومة.';
    expect(checkAgenticDraft(draft,[e])).toEqual([]);
    expect(checkAgenticDraft(draft.replace('÷ المقاومة.','÷ الإغلاق.'),[e])).toContain('screen_distance_formula_contradiction');
});
