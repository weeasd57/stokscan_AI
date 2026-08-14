const fs = require('fs');
const file = 'C:/Users/MR__CODER__/Desktop/stokscan_AI/web/src/lib/ai/evaluation-suite.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/\s*success:\s*true,/g, '');
content = content.replace(/\s*logs:\s*\[\]/g, 'formattedText: "mock data"');

fs.writeFileSync(file, content);
console.log("Cleaned StructuredToolOutput properties");
