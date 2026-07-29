export const AI_CONFIG = {
  models: {
    planner: {
      text: ["deepseek-ai/deepseek-v4-flash", "meta/llama-3.1-8b-instruct"],
      vision: ["nvidia/nemotron-nano-12b-v2-vl", "nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.2-11b-vision-instruct"],
    },
    response: {
      default: "deepseek-ai/deepseek-v4-flash",
      fallbacks: ["meta/llama-3.1-8b-instruct", "deepseek-ai/deepseek-v4-pro", "meta/llama-3.1-70b-instruct"],
      vision: ["nvidia/nemotron-nano-12b-v2-vl", "nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.2-11b-vision-instruct"],
    },
  },
  limits: {
    dailyMessages: 15,
    sessionHistoryCap: 15,
    plannerTimeoutMs: 15_000,
    responseTimeoutMs: 30_000,
    responseTimeoutFallbackMs: 20_000,
    cacheTtlMs: 24 * 60 * 60 * 1000,
  },
  api: {
    deepseekOfficialBaseUrl: "https://api.deepseek.com/chat/completions",
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
  unlimitedEmails: [
    "weeessd57@gmail.com",
    "user@gmail.com",
    "weeasd57@gmail.com",
  ],
  disclaimer: "✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.",
};
