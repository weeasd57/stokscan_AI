import { isConversationalChoiceOrFollowUp } from "../intent-policy";
import { runAnswerGate } from "../answer-gate";
import { IntentPlan } from "../types";

describe("Conversational Follow-Up Coherence & Answer Gate", () => {
    test("detects conversational choices, cap categories, styles and indecision", () => {
        expect(isConversationalChoiceOrFollowUp("صغيره")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("صغيرة")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("متوسطة")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("قيادية")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("مضاربة")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("استثمار")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("الاتنين")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("مش عارف")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("رشحلي انت")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("بورصة النيل")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("عقارات")).toBe(true);
        expect(isConversationalChoiceOrFollowUp("بنوك")).toBe(true);

        // Actual explicit ticker or company name must NOT be treated as conversational follow-up
        expect(isConversationalChoiceOrFollowUp("COMI")).toBe(false);
        expect(isConversationalChoiceOrFollowUp("حلل سهم طلعت مصطفى")).toBe(false);
    });

    test("answer-gate blocks amnesia complaints when replying to assistant question", () => {
        const history = [
            { role: "user", content: "اشترى الايام دى ولا السوق واقع" },
            { role: "assistant", content: "السوق في مرحلة تصحيح... هل تفضل التركيز على الأسهم القيادية أم الأسهم الصغيرة والمتوسطة؟" },
        ];
        const plan = { intent: "market_summary", entities: {}, tools: ["get_market"] } as IntentPlan;

        // Broken amnesia reply from LLM
        const brokenReply = "سؤالك «صغيره» غير واضح بما يكفي، هل تقصد أسهماً صغيرة أم ماذا؟ يرجى تحديد الشركة.";
        const failedResult = runAnswerGate({
            reply: brokenReply,
            plan,
            toolResults: [],
            userMessage: "صغيره",
            facts: [],
            history,
        });
        expect(failedResult.ok).toBe(false);
        expect(failedResult.reasons.join(" ")).toContain("إجابة محادثية مباشرة");

        // Coherent, contextual reply
        const goodReply = "بما أنك تفضل الأسهم الصغيرة والمتوسطة (EGX70)، فإليك قراءة لفرص التجميع والسيولة في هذا النطاق...";
        const okResult = runAnswerGate({
            reply: goodReply,
            plan,
            toolResults: [],
            userMessage: "صغيره",
            facts: [],
            history,
        });
        expect(okResult.ok).toBe(true);
    });

    test("answer-gate blocks treating category answer as unlisted SME stock", () => {
        const history = [
            { role: "user", content: "ايه افضل فرص دلوقتي" },
            { role: "assistant", content: "الفرص تختلف حسب طبيعة تداولك، هل تفضل مضاربة سريعة أم استثمار متوسط الأجل؟" },
        ];
        const plan = { intent: "technical_scan", entities: {}, tools: ["get_accumulation_stocks"] } as IntentPlan;

        const unlistedComplaint = "هذا السهم «مضاربة» غير مدرج في قاعدة بيانات الأسهم الرئيسية الـ 236 المسجلة على المنصة.";
        const failedResult = runAnswerGate({
            reply: unlistedComplaint,
            plan,
            toolResults: [],
            userMessage: "مضاربة",
            facts: [],
            history,
        });
        expect(failedResult.ok).toBe(false);
        expect(failedResult.reasons.join(" ")).toContain("إجابة محادثية مباشرة");
    });
});
