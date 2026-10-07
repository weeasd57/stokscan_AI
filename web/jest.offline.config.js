const base = require('./jest.config');

module.exports = async () => {
    const config = await base();
    return {
        ...config,
        moduleNameMapper: { ...config.moduleNameMapper, '^@/(.*)$': '<rootDir>/src/$1' },
        setupFiles: [...(config.setupFiles || []), '<rootDir>/scripts/jest-offline-network.cjs'],
        testPathIgnorePatterns: [...(config.testPathIgnorePatterns || []), '/load/', '(?:^|[.-])live(?:[.-]|$)'],
    };
};
