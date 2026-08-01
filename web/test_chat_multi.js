async function runTests() {
  const testCases = [
    "حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟"
  ];

  for (let i = 0; i < testCases.length; i++) {
    const q = testCases[i];
    console.log(`\n\n====================================================`);
    console.log(`[TEST ${i+1}] QUERY: ${q}`);
    console.log(`====================================================\n`);
    
    try {
      const response = await fetch("http://localhost:3000/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: q }]
        })
      });
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        process.stdout.write(chunk);
      }
      console.log(`\n[END OF RESPONSE]`);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
    }
  }
}

runTests();
