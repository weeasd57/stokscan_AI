const nextJest = require("next/jest");
const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/src/lib/__tests__/planner-vs-current-five-turn.test.js",
  ],
  testTimeout: 240000,
});
