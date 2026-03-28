module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'],
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
    setupFiles: ['<rootDir>/tests/setup.ts'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    globals: {
        'ts-jest': {
            diagnostics: false,
            isolatedModules: true,
            tsconfig: {
                target: 'ES2022',
                module: 'commonjs',
                esModuleInterop: true,
                skipLibCheck: true,
            },
        },
    },
    transformIgnorePatterns: [
        '/node_modules/(?!@stellar/stellar-sdk)',
    ],
};
