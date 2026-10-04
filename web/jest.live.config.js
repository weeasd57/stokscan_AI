const nextJest = require("next/jest");
const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
    testEnvironment: "node",
    testMatch: [
        "<rootDir>/src/lib/__tests__/chat-live-integration.test.js",
        "<rootDir>/src/lib/__tests__/automation-full-eval.test.js",
        "<rootDir>/src/lib/__tests__/live-user-scenario.test.js",
        "<rootDir>/src/lib/__tests__/oct4-context-live.test.js",
    ],
    testTimeout: 60000,
});
