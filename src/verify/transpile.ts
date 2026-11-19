import { ts } from "ts-morph";

/** TypeScript/JSX -> ESM JavaScript. A require() shim is added for CommonJS-style files. */
export function toModuleSource(file: string, source: string): string {
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  if (!/\brequire\s*\(/.test(js)) return js;
  return `import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);\n${js}`;
}
