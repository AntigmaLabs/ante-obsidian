import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  ...obsidianmd.configs.recommended,
  {
    ignores: ["node_modules/**", "main.js", "styles.css", ".release/**", "dist/**"]
  },
  {
    files: ["packages/ante-obsidian-plugin/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./packages/ante-obsidian-plugin/tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    }
  }
];
