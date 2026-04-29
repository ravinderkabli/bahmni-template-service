import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',          // Express startup — integration-tested, not unit-tested
    '!src/adapters/pdfAdapter.ts', // Puppeteer — requires real Chromium in CI
  ],
};

export default config;
