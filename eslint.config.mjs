import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
    {
        ignores: ["dist/**", "node_modules/**", "extra/**", "example/dist/**", "src/assets/default-skin/**"]
    },
    js.configs.recommended,
    {
        files: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "example/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                sourceType: "module",
                ecmaVersion: "latest"
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.bun
            }
        },
        plugins: {
            "@typescript-eslint": tsPlugin
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            "no-undef": "off",
            "no-empty": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ],
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-explicit-any": "off"
        }
    }
];
