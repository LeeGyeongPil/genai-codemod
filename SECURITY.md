# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

이 CLI 는 네트워크 포트를 열지 않습니다. `verify` 는 가짜 fetch 아래에서 내 코드의 진입 함수를 실제로 실행하므로 믿을 수 있는 코드에만 쓰세요. 파일 옆에 임시 `.genai-codemod-*.mjs` 를 만들었다가 지웁니다.

The CLI opens no network port. `verify` runs your code (the entry function) under a fetch mock, so only run it on code you trust. It writes and removes a temporary `.genai-codemod-*.mjs` next to the file.
