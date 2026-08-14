const fs = require('fs');
const file = 'C:/Users/MR__CODER__/Desktop/stokscan_AI/web/src/lib/ai/evaluation-suite.ts';
let content = fs.readFileSync(file, 'utf8');

// The easiest way is to match from `data:` down to the closing `}` of the object and replace it cleanly.
content = content.replace(/data:\s*createMockStock\(\)(.*?)\}/gs, 'data: createMockStock(),\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"\n                }');
content = content.replace(/data:\s*createMockStock\(\{ macd_signal: null, macd_histogram: null \}\)(.*?)\}/gs, 'data: createMockStock({ macd_signal: null, macd_histogram: null }),\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"\n                }');
content = content.replace(/data:\s*createMockStock\(\{ distribution_score: 0, volume_ratio: 2.0 \}\)(.*?)\}/gs, 'data: createMockStock({ distribution_score: 0, volume_ratio: 2.0 }),\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"\n                }');
content = content.replace(/data:\s*createMockStock\(\{ volume_ratio: 1.2, rsi: 75 \}\)(.*?)\}/gs, 'data: createMockStock({ volume_ratio: 1.2, rsi: 75 }),\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"\n                }');

content = content.replace(/total_matched: 2\s*\}(.*?)\}/gs, 'total_matched: 2\n                    },\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["COMI", "FAWR"],\n                    data_type: "live"\n                }');

content = content.replace(/total_matched: 5\s*\}(.*?)\}/gs, 'total_matched: 5\n                    },\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["A", "B", "C", "D", "E"],\n                    data_type: "live"\n                }');

fs.writeFileSync(file, content);
console.log("Cleaned duplicates");
