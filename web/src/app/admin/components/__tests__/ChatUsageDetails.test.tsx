/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ChatUsageDetails, UserChatCost } from "../ChatUsageDetails";
test("renders small USD amounts without rounding to zero and per-call metadata", () => {
    render(<ChatUsageDetails log={{ id: "question-id", assistant_message_id: "reply-id", created_at: "2026-10-10T12:00:00Z", usage: {model: "deepseek-flash", cost_usd: 0.000123, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, provider_calls: 1, calls: [{stage: "vision", provider: "deepseek", model: "deepseek-flash", cost_usd: 0.000123}]} }} />);
    expect(screen.getByText(/استهلاك الرسالة/).textContent).toContain("$0.000123");
    expect(screen.getByText("reply-id")).toBeTruthy();
    expect(screen.getByText(/قراءة صورة/)).toBeTruthy();
});
test("unknown message cost and partial user total are explicit", () => {
    const { container } = render(<><ChatUsageDetails log={{id: "old", created_at: "2026-10-10"}} /><UserChatCost summary={{cost_usd: 0.01, messages: 10, unpriced_messages: 3, total_tokens: 100}} complete={false} /></>);
    expect(container.textContent).toContain("التكلفة غير متاحة");
    expect(container.textContent).toContain("إجمالي جزئي");
    expect(container.textContent).toContain("3 رسالة بتكلفة ناقصة");
});
