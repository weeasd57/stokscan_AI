import { canTraceChat, createDiagnosticTrace } from "../diagnostic-trace";
test("trace authorization uses trusted admin identity only", () => {
    expect(canTraceChat({id:"u",user_metadata:{role:"admin"}})).toBe(false);
    expect(canTraceChat({id:"u",email:"weeasd57@attacker.example"})).toBe(false);
    expect(canTraceChat({id:"u",app_metadata:{role:"admin"}})).toBe(true);
    expect(canTraceChat(null)).toBe(false);
});
test("bounded immutable capture marks incomplete instead of silently dropping evidence", () => {
    const trace=createDiagnosticTrace(true,50);
    const data={content:"original"}; trace.capture("response",data);data.content="changed";
    trace.capture("large",{content:"x".repeat(100)});
    const result=trace.snapshot()!;
    expect(result.complete).toBe(false);
    expect(result.entries[0].data.content).toBe("original");
    expect(result.entries[0].sha256).toHaveLength(64);
});
test("ordinary users are not traced", () => {
    const trace=createDiagnosticTrace(false);trace.capture("private",{content:"user text"});expect(trace.snapshot()).toBeNull();
});
