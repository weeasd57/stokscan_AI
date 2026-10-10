import { createChatRequest } from "../chat-request.cjs";
test("UI and production verification send the identical session-aware SSE contract", () => {
    const request = createChatRequest({message:"اختبار", model:"deepseek-reasoner", sessionId:"session", clientMessageId:"session:123", history:[{role:"user",content:"السياق السابق"}], images:["data:image/png;base64,AAAA"], chartContext:{active_chart_id:"panel"}});
    expect(request.headers).toEqual({"Content-Type":"application/json",Accept:"text/event-stream, application/json","x-stream":"true"});
    expect(JSON.parse(request.body)).toEqual({message:"اختبار",model:"deepseek-reasoner",session_id:"session",client_message_id:"session:123",history:[{role:"user",content:"السياق السابق"}],images:["data:image/png;base64,AAAA"],image:"data:image/png;base64,AAAA",stream:true,chart_context:{active_chart_id:"panel"}});
});
test("does not add fake test mode or credentials to the normal browser request", () => {
    const request=createChatRequest({message:"",model:"deepseek-chat",sessionId:"s",clientMessageId:"id"});
    expect(JSON.parse(request.body)).toEqual({message:"قم بقراءة وتحليل هذه الصورة المرفقة.",history:[],model:"deepseek-chat",session_id:"s",client_message_id:"id",stream:true});
});
