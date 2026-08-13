export const AI_CONFIG = {
  models: {
    planner: {
      text: ["deepseek-chat"],
      vision: ["nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.2-11b-vision-instruct"],
    },
    response: {
      default: "deepseek-chat",
      fallbacks: [],
      allowedUserModels: [
        "deepseek-chat",
        "deepseek-reasoner"
      ],
      vision: ["nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.2-11b-vision-instruct"],
    },
  },
  limits: {
    dailyMessages: 50,
    sessionHistoryCap: 15,
    plannerTimeoutMs: 6_000,
    plannerMaxTokens: 320,
    toolsTimeoutMs: 12_000,
    responseTimeoutMs: 12_000,
    requestDeadlineMs: 52_000,
    responseMaxTokens: 800,
    responseTimeoutFallbackMs: 20_000,
    cacheTtlMs: 24 * 60 * 60 * 1000,
  },
  api: {
    deepseekBaseUrl: "https://api.deepseek.com/chat/completions",
    nvidiaBaseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
  },
  tools: {
    defaultCountry: "Egypt",
    defaultExchange: "EGX",
    recommendationsLimit: 10,
    recommendationsLimitOldest: 5,
    newsLimit: 25,
    newsDaysLookback: 7,
    indexSymbols: ["EGX30", "EGX70", "EGX100"],
    defaultPrecision: 85,
    topGainersLosersLimit: 5,
    newsHeadlinesMaxPerDay: 8,
    newsDaysDisplay: 3,
  },
  disclaimer: "✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.",
};
