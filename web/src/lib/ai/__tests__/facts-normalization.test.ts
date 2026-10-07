import { buildFactRecords } from "../facts";

const result = (data: unknown, data_time: unknown = "2026-10-07T10:00:00.000Z") => [{
    tool: "get_stock",
    source: "live_session",
    data_time,
    data,
}];

describe("buildFactRecords numeric normalization", () => {
    test("does not turn empty strings or unit-only values into numeric zero", () => {
        const facts = buildFactRecords(result({
            symbol: "TEST",
            price: "   ",
            current_price: "",
            rsi_14: "%",
            vol_ratio: "x",
            change_pct: "1x2%",
            macd: true,
            support: "Infinity",
            resistance: "NaN",
        }));

        expect(facts).toEqual([]);
    });

    test("preserves real zero, negatives, percentages, ratios, and grouped values", () => {
        const facts = buildFactRecords(result({
            symbol: "TEST",
            acc_score: 0,
            change_pct: "-.58%",
            vol_ratio: ".67x",
            value: "1,250.5",
            macd: -0.25,
        }));

        expect(facts.map(({ field, value }) => [field, value])).toEqual([
            ["change_pct", -0.58],
            ["macd", -0.25],
            ["vol_ratio", 0.67],
            ["value", 1250.5],
            ["acc_score", 0],
        ]);
    });

    test("normalizes Arabic and Persian digits and numeric separators", () => {
        const facts = buildFactRecords(result({
            symbol: "TEST",
            change_pct: "−٠٫٥٨٪",
            vol_ratio: "۰٫۶۷x",
            value: "١٬٢٥٠٫٥",
        }));

        expect(facts.map(({ field, value }) => [field, value])).toEqual([
            ["change_pct", -0.58],
            ["vol_ratio", 0.67],
            ["value", 1250.5],
        ]);
    });

    test("rejects malformed thousands grouping instead of concatenating digits", () => {
        const facts = buildFactRecords(result({ symbol: "TEST", price: "12,34" }));
        expect(facts).toEqual([]);
    });

    test("uses the canonical alias first and falls through when it is missing", () => {
        const canonicalWins = buildFactRecords(result({ symbol: "TEST", price: 0, current_price: 25 }));
        const aliasFallback = buildFactRecords(result({ symbol: "TEST", price: "", current_price: 25 }));

        expect(canonicalWins.find(fact => fact.field === "price")?.value).toBe(0);
        expect(aliasFallback.find(fact => fact.field === "price")?.value).toBe(25);
    });
});

describe("buildFactRecords date provenance", () => {
    test("drops non-string and invalid dates without replacing source or fetch provenance", () => {
        const [factsFromNumberDate, factsFromInvalidDate] = [
            buildFactRecords(result({ symbol: "TEST", price: 10 }, 1780000000000)),
            buildFactRecords(result({ symbol: "TEST", rsi_14: 40 }, "not-a-date")),
        ];

        expect(factsFromNumberDate[0]).toMatchObject({
            symbol: "TEST", field: "price", value: 10, as_of: null, source: "live_session", tool: "get_stock",
        });
        expect(factsFromNumberDate[0].fetched_at).toEqual(expect.any(String));
        expect(factsFromInvalidDate[0].as_of).toBeNull();
    });

    test.each([
        "2026-02-30",
        "2026-13-01",
        "0",
        "2026-10-07 ",
        "2026-10-07T10:00:00",
        "2026-10-07 10:00:00Z",
        "2026-10-07T10:00:00+14:30",
    ])("rejects invalid or ambiguous date format %s", data_time => {
        const facts = buildFactRecords(result({ symbol: "TEST", price: 10 }, data_time));
        expect(facts[0].as_of).toBeNull();
    });

    test.each([
        "2026-02-28",
        "2024-02-29",
        "2026-10-07T10:00:00Z",
        "2026-10-07T10:00:00.123+03:00",
        "2026-11-06T05:30:21.414874+00:00",
        "2026-11-06T05:30:21.414874291+00:00",
    ])("preserves valid ISO date or zoned timestamp %s", data_time => {
        const facts = buildFactRecords(result({ symbol: "TEST", price: 10 }, data_time));
        expect(facts[0].as_of).toBe(data_time);
    });

    test("invalid per-metric dates remain unknown; valid timestamps are preserved verbatim", () => {
        const facts = buildFactRecords(result({
            symbol: "TEST",
            rsi_14: 0,
            macd: -1,
            metric_dates: {
                rsi_14: "not-a-date",
                macd: "2026-10-06T14:30:00.000Z",
            },
        }));

        expect(facts.find(fact => fact.field === "rsi")?.as_of).toBeNull();
        expect(facts.find(fact => fact.field === "macd")?.as_of).toBe("2026-10-06T14:30:00.000Z");
    });

    test("two legitimate dated observations for one field remain distinct", () => {
        const facts = buildFactRecords([
            ...result({ symbol: "TEST", price: 10 }, "2026-10-06"),
            ...result({ symbol: "TEST", price: 11 }, "2026-10-07"),
        ]);

        expect(facts.filter(fact => fact.field === "price").map(fact => [fact.value, fact.as_of])).toEqual([
            [10, "2026-10-06"],
            [11, "2026-10-07"],
        ]);
    });
});
