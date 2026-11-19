# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-11-20

### Fixed
- `verify --timeout` refuses values above 2147483 seconds (about 24.8 days). Node's timers cannot hold more, so such a value used to fire after 1 ms and stop a normal entry function at once with a misleading message. The library API caps the value instead.
- Korean messages no longer attach a particle to a quoted value whose last sound does not match it (for example the `--api-version`, `--lang`, `--response` and `--timeout` errors, the timeout message, and the `client-exported` / `client-shared` texts).

### Changed
- CI runs macOS jobs only when the repository is public; Linux with Node.js 22 and 24 runs on every push. A private repository pays about ten times more for macOS runner minutes.
- CI checks right after `npm ci` that the platform's native TypeScript compiler is installed, and the tests guard that `package-lock.json` keeps the native packages for Linux and macOS and that relative imports match file names with the exact case (Linux file systems are case-sensitive).
- A test covers SIGTERM during `verify` as well as Ctrl+C.

## [0.1.3] - 2026-11-20

### Added
- `verify --timeout <seconds>` (default 60): an entry function that has not finished by then is stopped with a message naming the file and the function, exit code 2. Before, an entry that never resolved made `verify` wait forever.

### Fixed
- Pressing Ctrl+C (or sending SIGTERM) during `verify` now deletes the temporary `.genai-codemod-*.mjs` module next to your source before exiting with 130 (143 for SIGTERM).
- Usage errors from the option parser no longer end with a double period.

### Changed
- CI runs on Linux and macOS with Node.js 22 and 24 (`fail-fast` off), so a failure shows whether it depends on the OS or the Node.js version.
- Source comments are in English.

## [0.1.2] - 2026-11-19

### Fixed
- The CLI now exits as soon as its output is written. Before, `verify` could hang when the checked entry function left a timer or socket open, because the user's code kept Node.js running.
- Folder scans are sorted by code point instead of `localeCompare`, so the order of diffs and report entries no longer depends on the machine's locale.
- `npm start` stops a demo step that does not finish within 120 seconds and says which command hung.

### Changed
- CI: a 15-minute job limit and a step that prints the Node.js and npm versions; test child processes have a 45-second limit so a hang fails with a message instead of stalling the job.

## [0.1.1] - 2026-11-19

### Fixed
- `verify` no longer picks up temporary modules created by other test processes while scanning, which made parallel test runs flaky.

### Changed
- Package metadata: added `repository`, `homepage` and `bugs` fields.
- Version bumped to 0.1.1 in `package.json`, `package-lock.json` and the README examples.

## [0.1.0] - 2026-11-19

### Added
- Codemod from `@google/generative-ai` and `@google-cloud/vertexai` to `@google/genai` (ts-morph): imports and `require`, clients, `getGenerativeModel` handle tracking, `generateContent`, `generateContentStream`, `countTokens`, `embedContent`, `startChat` and `sendMessage`, flattened `config`, response getters and stream loops.
- Conservative reporting with file:line TODOs (`dynamic-model-params`, `handle-escapes`, `text-throws-on-block`, `stream-aggregate`, `server-managers`, `request-options`, `vertex-function-schema`, `vertex-preview`, `unsupported-usage`, `unsupported-import-form`, `cross-module`, `client-exported`) and warnings (`api-version-pinned`, `api-version-default-changed`, `vertex-api-version-default-changed`, `nested-generation-config`, `node-engine`, `duplicate-genai`, `client-shared`).
- Shared clients across modules: a client created and exported in one scanned file (`export const`, `export { x as y }`, `export default`, `module.exports`) is followed into the scanned files that import it, so both sides are migrated in the same run. Clients or model handles that cannot be followed are reported (`cross-module` in the importer, `client-exported` when no scanned file imports a rewritten client).
- `verify` command: runs the real old and new SDKs under a `fetch` mock and compares requests and return values (`ok` / `blocked` responses, SSE streams, `--vertex` fake auth client). Local imports are resolved relative to each file (for `--out-dir` output, from the original folder as a fallback); a missing one is explained with the fix.
- Dry-run diff, `--write`, `--out-dir`, `--report` JSON, `--api-version keep|sdk-default`, exit codes 0/1/2.
- English and Korean output (`--lang`, `GENAI_CODEMOD_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`).
- Sample app `examples/legacy-app` and `npm start` demo.
