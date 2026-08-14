const fs = require('fs');
const file = 'C:/Users/MR__CODER__/Desktop/stokscan_AI/web/src/lib/ai/evaluation-suite.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace standard get_stock_levels matches
content = content.replace(/tool:\s*"get_stock_levels",\s*data:\s*createMockStock\(([^)]*)\)/g, 
    'tool: "get_stock_levels",\n                    data: createMockStock($1),\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"');

// Replace screen_market matches
content = content.replace(/total_matched:\s*(\d+)\s*\n\s*\}/g, 
    'total_matched: $1\n                    },\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["COMI", "FAWR", "A", "B", "C", "D", "E"],\n                    data_type: "live"');

fs.writeFileSync(file, content);
console.log("Done");
