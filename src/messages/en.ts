/** English message catalog. ko.ts must define exactly the same keys. */
export const en = {
  "help": `genai-codemod - migrate @google/generative-ai and @google-cloud/vertexai code to @google/genai

Usage:
  genai-codemod [paths...] [options]           Rewrite files (dry run by default: prints a diff)
  genai-codemod verify <before> <after> [opts] Check that two versions send the same API requests

Rewrite options:
  --write                  Save the rewritten files in place
  --out-dir <dir>          Write rewritten files to <dir> instead (originals untouched)
  --report <file>          Write a JSON report (summary, TODOs, warnings)
  --api-version <mode>     keep (default): pin the endpoint version the old SDK used
                           sdk-default: let @google/genai choose (v1 / Vertex v1beta1)
  --lang <en|ko>           Output language
  --no-color               Plain output

Verify options:
  --entry <name>           Exported function to call in both files (default: run)
  --response <ok|blocked>  Canned API response served by the fetch mock (default: ok)
  --vertex                 Pass a fake auth client ({ authClient }) to the entry function
  --timeout <seconds>      Stop an entry function that has not finished by then (default: 60)
  --json                   Print the result as JSON

Other:
  -h, --help               Show this help
  -v, --version            Show the version

Paths may be files or folders (.ts .tsx .mts .cts .js .jsx .mjs .cjs; node_modules, dist,
build and hidden folders are skipped). Default: the current folder.
Exit codes: 0 clean, 1 TODOs found or requests differ, 2 usage or parse error.

verify runs YOUR code (the entry function) with a fake fetch; use it on code you trust.`,
  "err.pathMissing": "Path not found: {path}. Check the spelling or pass an existing file or folder.",
  "err.badApiVersion": "Invalid --api-version value \"{value}\". Use keep or sdk-default.",
  "err.badLang": "Invalid --lang value \"{value}\". Use en or ko.",
  "err.badResponse": "Invalid --response value \"{value}\". Use ok or blocked.",
  "err.badTimeout": "Invalid --timeout value \"{value}\". Use a number of seconds greater than 0 and at most {max}, e.g. --timeout 120.",
  "err.entryTimeout": "{file}: \"{entry}\" did not finish within {seconds} s, so verify stopped. It probably waits for something that never ends (a stream, timer or connection the mock does not answer). Make the function return, or allow more time with --timeout <seconds>.",
  "err.writeAndOut": "--write and --out-dir cannot be used together. Pick one.",
  "err.nodeVersion": "genai-codemod needs Node.js 22 or newer (found {found}). Upgrade Node.js and run it again.",
  "err.unknownOption": "Unknown option {option}. Run genai-codemod --help.",
  "err.usage": "Usage error: {detail}. Run genai-codemod --help.",
  "err.parse": "Could not parse {path}: {detail}",
  "err.verifyArgs": "verify needs exactly two files: genai-codemod verify <before> <after>.",
  "err.entryMissing": "{file} does not export an async function named \"{entry}\". Export one (or pass --entry <name>); verify calls it with no arguments.",
  "err.sdkMissing": "Could not load \"{pkg}\" for {file}. Install both the old and the new SDK as dev dependencies for the check, e.g. npm install -D @google/generative-ai @google/genai.",
  "err.authMissing": "--vertex needs {pkg} and its google-auth-library to be installed (looked from {file}).",
  "err.verifyRun": "Running {file} failed: {detail}",
  "err.localImportMissing": "{file} imports {specifier}, which was not found next to it ({path}). verify runs each file in its own folder, so the old copy needs its whole tree: verify the --out-dir output before --write, or restore the old tree inside the project (mkdir old && git archive HEAD src | tar -x -C old) and run verify old/src/<file> src/<file>.",
  "err.fileRead": "Cannot read {path}: {detail}",
  "sum.line": "Summary: {scanned} files scanned, {changed} files changed {mode}, {todos} TODOs, {warnings} warnings",
  "mode.dry": "(dry run, nothing written)",
  "mode.write": "(written)",
  "mode.out": "(written to {dir})",
  "sum.todoTitle": "TODOs - not rewritten automatically, fix these by hand:",
  "sum.warnTitle": "Warnings:",
  "sum.hintWrite": "Run again with --write to apply the changes (or --out-dir <dir> to keep the originals).",
  "sum.hintVerify": "Check the result with: genai-codemod verify <before> <after>",
  "sum.wrote": "wrote {path}",
  "v.title": "Request equivalence: {before} vs {after}",
  "v.mode": "Mock response: {response}{vertex}",
  "v.vertexSuffix": ", Vertex auth injected",
  "v.requests": "Requests sent: {before} vs {after}",
  "v.rules": "Normalization rules applied:",
  "v.rule.role": "systemInstruction.role is ignored (old SDK sends \"system\", new SDK sends \"user\"; same meaning on the server)",
  "v.rule.emptyDefaults": "an empty generationConfig {} and an empty safetySettings [] equal their absence (the old SDK always sent them)",
  "v.rule.order": "object key order is ignored",
  "v.diffs": "Differences:",
  "v.resultMatch": "Result: MATCH - both versions send the same requests and return the same value",
  "v.resultMismatch": "Result: MISMATCH - {count} difference(s)",
  "v.mockNote": "Practice mock: the real SDKs ran, but no request left your machine. This proves the requests are equal, not that the server accepts them.",
  "todo.dynamic-model-params": "Model parameters are not a plain object literal ({detail}); left unchanged. Move the options to each call by hand: ai.models.generateContent({ model, contents, config }).",
  "todo.handle-escapes": "The model handle or a result is used in a way the codemod cannot follow ({detail}); the handle was left unchanged. Pass the model name and config to each call instead.",
  "todo.text-throws-on-block": "response.text() threw when a response was blocked; the new .text is undefined instead. The code was rewritten, but this try/catch no longer catches blocked responses - check the finish reason or the undefined value.",
  "todo.stream-aggregate": "await r.response (the aggregated stream) does not exist in the new SDK. Collect the chunks yourself while iterating, then process the joined result.",
  "todo.server-managers": "Cache and file managers from @google/generative-ai/server have no automatic rewrite. Use ai.caches.* and ai.files.* from @google/genai by hand.",
  "todo.request-options": "Request options (timeout, baseUrl, extra arguments) are not carried over; left unchanged. Use httpOptions in the GoogleGenAI constructor by hand.",
  "todo.vertex-function-schema": "Vertex function declaration schemas (function_declarations, FunctionDeclarationSchemaType) are not rewritten. Use functionDeclarations and the Type enum from @google/genai by hand.",
  "todo.vertex-preview": "vertexAI.preview.* has no automatic rewrite. Use the matching ai.* service from @google/genai by hand.",
  "todo.unsupported-usage": "This usage has no automatic rewrite ({detail}); left unchanged. Check the @google/genai migration guide.",
  "todo.unsupported-import-form": "This import form (namespace, default or whole-module require) is not rewritten; left unchanged. Import the names you need from @google/genai by hand.",
  "todo.cross-module": "{name} comes from {module} and is still used with the old SDK here ({detail}); left unchanged. Scan both files in one run (pass their folder) so a shared client is followed, or move these calls to ai.models.* by hand.",
  "todo.client-exported": "This client is exported as \"{name}\" and was rewritten, but no scanned file imports it. Files that import it still call getGenerativeModel() and will break: scan them in the same run (pass their folder) or migrate them by hand.",
  "warn.client-shared": "This client is exported as \"{name}\"; {count} scanned file(s) import it and were handled in the same run (rewritten, or listed as TODOs). Files outside the scanned paths that import it need the same migration.",
  "warn.api-version-pinned": "Pinned apiVersion \"{version}\" to keep the endpoint version the old SDK used. @google/genai 3.x defaults to v1 (Vertex: v1beta1); drop the pin or set GOOGLE_GENAI_API_VERSION once you have tested the default.",
  "warn.api-version-default-changed": "No apiVersion pin: @google/genai 3.x calls the Gemini API on v1, the old SDK used v1beta. Some models and aliases exist only on v1beta. Run verify to see the path change.",
  "warn.vertex-api-version-default-changed": "No apiVersion pin: @google/genai calls Vertex AI on v1beta1, the old SDK used v1. Run verify --vertex to see the path change.",
  "warn.nested-generation-config": "config.generationConfig is silently dropped by @google/genai. Move its keys directly into config (for example config: { temperature: 0.2 }).",
  "warn.node-engine": "engines.node allows Node.js below 22 ({range}), but @google/genai 3.x needs Node.js 22 or newer. Raise engines.node or stay on an older @google/genai release.",
  "demo.step1": "1. Dry run on one file (diff only)",
  "demo.step2": "2. Migrate the sample app into .demo-out/",
  "demo.step3": "3. verify: Gemini API code",
  "demo.step4": "4. verify: Vertex AI code",
  "demo.step5": "5. Hidden difference: let the SDK pick its default API version",
  "demo.step5b": "5b. verify shows the changed request path",
  "demo.step6": "6. verify with a blocked response",
  "demo.done": "Done. Open .demo-out/ to see the migrated files.",
  "demo.next": "Next: npm run demo:hidden shows two differences that only verify can catch.",
  "demo.unexpectedExit": "Unexpected exit code {code} (expected {expected}).",
  "demo.timeout": "The step did not finish within {seconds} s and was stopped. Run the command above on its own to see where it hangs.",
  "warn.duplicate-genai": "Both @google-cloud/vertexai and @google/genai are dependencies; the old package pulls in its own copy of @google/genai. Remove @google-cloud/vertexai after the migration."
} as const;
