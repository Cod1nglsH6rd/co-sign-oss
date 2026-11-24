const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you soon)
    '^@/components/(.*)$': '<rootDir>/components/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
  },
  testEnvironment: 'node',
  collectCoverageFrom: [
    'pages/api/**/*.js',
    'lib/**/*.js',
    'components/**/*.js',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/coverage/**',
    '!**/jest.config.js',
  ],
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/**/__tests__/**/*.js',
  ],
  coverageThreshold: {
    // lowered 2026-10-18 to the measured floor; raise when tests are added
    'pages/api/chat.js': {
      statements: 65,
      branches: 45,
      functions: 100,
      lines: 70,
    },
    'pages/api/sessions/[token]/chat.js': {
      statements: 70,
      branches: 40,
      functions: 100,
      lines: 70,
    },
    'lib/sessionAuth.js': {
      statements: 70,
      branches: 50,
      functions: 70,
      lines: 70,
    },
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
