const http = require('http');

const data = JSON.stringify({
  message: 'حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟',
  history: []
});

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/ai-chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`CHUNK: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
