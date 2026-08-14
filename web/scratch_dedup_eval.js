const fs = require('fs');
const file = 'C:/Users/MR__CODER__/Desktop/stokscan_AI/web/src/lib/ai/evaluation-suite.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace everything between data: and closing brace of ToolResult with the correct fields once.
// Example:
// data: createMockStock(),
// source: "mock",
// data_time: new Date().toISOString(),
// symbols: ["EGAL"],
// data_type: "live"
// source: "mock", ...

content = content.replace(/source:\s*"mock",\s*data_time:\s*new Date\(\)\.toISOString\(\),\s*symbols:\s*\["[^\]]+"\],\s*data_type:\s*"live"/g, '---MARKER---');
content = content.replace(/(---MARKER---\s*)+/g, 'source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["EGAL"],\n                    data_type: "live"');

// Fix the screen_market one manually if it got EGAL
content = content.replace(/symbols: \["COMI", "FAWR"\],\s*data_type: "live"\s*},\s*source: "mock",\s*data_time: new Date\(\)\.toISOString\(\),\s*symbols: \["EGAL"\],\s*data_type: "live"/g, 
'symbols: ["COMI", "FAWR"],\n                    data_type: "live"\n                    },\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["COMI", "FAWR"],\n                    data_type: "live"');

content = content.replace(/symbols: \["A", "B", "C", "D", "E"\],\s*data_type: "live"\s*},\s*source: "mock",\s*data_time: new Date\(\)\.toISOString\(\),\s*symbols: \["EGAL"\],\s*data_type: "live"/g, 
'symbols: ["A", "B", "C", "D", "E"],\n                    data_type: "live"\n                    },\n                    source: "mock",\n                    data_time: new Date().toISOString(),\n                    symbols: ["A", "B", "C", "D", "E"],\n                    data_type: "live"');

fs.writeFileSync(file, content);
console.log("Deduplicated properties");
