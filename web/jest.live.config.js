const nextJest = require("next/jest");
const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
    testEnvironment: "node",
    testMatch: ["<rootDir>/src/lib/__tests__/chat-live-integration.test.js"],
    testTimeout: 30000,
});
