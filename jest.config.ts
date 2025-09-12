import type { Config } from 'jest'
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  verbose: true,
}
export default config
