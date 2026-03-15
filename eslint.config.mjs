import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['mcdu-client/'],
    },
    {
        files: ['test/**/*.js', '*.test.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                beforeEach: 'readonly',
                after: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
];
