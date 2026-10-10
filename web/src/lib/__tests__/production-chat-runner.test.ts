const { readSse } = require("../../../scripts/verify-chat-production.cjs");
function response(text: string, size=5) {const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=size)controller.enqueue(bytes.slice(i,i+size));controller.close();}}),{headers:{"content-type":"text/event-stream"}});}
test("reads real SSE framing across split Arabic UTF-8 chunks",async()=>{
    const result=await readSse(response('data: {"type":"token","content":"أهلاً"}\n\ndata: {"type":"done","reply":"أهلاً"}\n\ndata: [DONE]\n\n',1));expect(result.done.reply).toBe("أهلاً");expect(result.events).toHaveLength(2);
});
test("[DONE] marker alone is not success and server error is not swallowed",async()=>{
    await expect(readSse(response("data: [DONE]\n\n"))).rejects.toThrow("canonical JSON done");
    await expect(readSse(response('data: {"type":"error","detail":"failed"}\n\n'))).rejects.toThrow("SSE error");
});
