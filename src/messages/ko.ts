import type { en } from "./en.js";

/** Korean message catalog. Same keys as en.ts (checked by the type and by tests). */
export const ko: Record<keyof typeof en, string> = {
  "help": `genai-codemod - @google/generative-ai, @google-cloud/vertexai 코드를 @google/genai 로 옮깁니다

사용법:
  genai-codemod [경로...] [옵션]               파일 변환 (기본은 드라이런: diff 만 출력)
  genai-codemod verify <전> <후> [옵션]        두 버전이 같은 API 요청을 보내는지 검사

변환 옵션:
  --write                  변환 결과를 원본 파일에 저장
  --out-dir <폴더>         원본은 두고 변환 결과를 <폴더> 에 저장
  --report <파일>          JSON 보고서 저장 (요약, TODO, 경고)
  --api-version <모드>     keep(기본): 구 SDK 가 쓰던 엔드포인트 버전을 고정
                           sdk-default: @google/genai 기본값 사용 (v1 / Vertex v1beta1)
  --lang <en|ko>           출력 언어
  --no-color               색 없이 출력

verify 옵션:
  --entry <이름>           두 파일에서 호출할 내보낸 함수 (기본: run)
  --response <ok|blocked>  fetch 목이 돌려줄 가짜 응답 (기본: ok)
  --vertex                 진입 함수에 가짜 인증 클라이언트({ authClient }) 전달
  --json                   결과를 JSON 으로 출력

기타:
  -h, --help               도움말
  -v, --version            버전

경로는 파일이나 폴더(.ts .tsx .mts .cts .js .jsx .mjs .cjs, node_modules·dist·build·숨김 폴더 제외).
생략하면 현재 폴더. 종료 코드: 0 깨끗함, 1 TODO 발견 또는 요청 불일치, 2 사용 오류·파싱 실패.

verify 는 사용자의 코드(진입 함수)를 가짜 fetch 아래에서 실제로 실행합니다. 믿을 수 있는 코드에만 쓰세요.`,
  "err.pathMissing": "경로를 찾을 수 없습니다: {path}. 철자를 확인하거나 존재하는 파일·폴더를 넘기세요.",
  "err.badApiVersion": "--api-version 값 \"{value}\" 이 올바르지 않습니다. keep 또는 sdk-default 를 쓰세요.",
  "err.badLang": "--lang 값 \"{value}\" 이 올바르지 않습니다. en 또는 ko 를 쓰세요.",
  "err.badResponse": "--response 값 \"{value}\" 이 올바르지 않습니다. ok 또는 blocked 를 쓰세요.",
  "err.writeAndOut": "--write 와 --out-dir 는 함께 쓸 수 없습니다. 하나만 고르세요.",
  "err.nodeVersion": "genai-codemod 는 Node.js 22 이상이 필요합니다(현재 {found}). Node.js 를 올린 뒤 다시 실행하세요.",
  "err.unknownOption": "알 수 없는 옵션 {option}. genai-codemod --help 를 확인하세요.",
  "err.usage": "사용 오류: {detail}. genai-codemod --help 를 확인하세요.",
  "err.parse": "{path} 를 파싱할 수 없습니다: {detail}",
  "err.verifyArgs": "verify 에는 파일 두 개가 필요합니다: genai-codemod verify <전> <후>.",
  "err.entryMissing": "{file} 에 \"{entry}\" 라는 이름의 async 함수가 내보내져 있지 않습니다. 하나 내보내거나(--entry <이름>) 지정하세요. verify 는 인자 없이 호출합니다.",
  "err.sdkMissing": "{file} 에 필요한 \"{pkg}\" 를 불러오지 못했습니다. 검사를 위해 구 SDK 와 새 SDK 를 모두 개발 의존성으로 설치하세요. 예: npm install -D @google/generative-ai @google/genai.",
  "err.authMissing": "--vertex 에는 {pkg} 와 그 google-auth-library 설치가 필요합니다({file} 기준으로 찾았습니다).",
  "err.verifyRun": "{file} 실행에 실패했습니다: {detail}",
  "err.localImportMissing": "{file} 이(가) import 하는 {specifier} 를 그 옆에서 찾지 못했습니다({path}). verify 는 각 파일을 그 파일의 폴더에서 실행하므로 이전 사본에는 폴더 구조 전체가 필요합니다: --write 전에 --out-dir 결과로 verify 하거나, 이전 트리를 프로젝트 안에 복원(mkdir old && git archive HEAD src | tar -x -C old)한 뒤 verify old/src/<파일> src/<파일> 을 실행하세요.",
  "err.fileRead": "{path} 를 읽을 수 없습니다: {detail}",
  "sum.line": "요약: 파일 {scanned}개 검사, {changed}개 변경 {mode}, TODO {todos}개, 경고 {warnings}개",
  "mode.dry": "(드라이런, 저장 안 함)",
  "mode.write": "(저장함)",
  "mode.out": "({dir} 에 저장함)",
  "sum.todoTitle": "TODO - 자동으로 바꾸지 않았습니다. 직접 고치세요:",
  "sum.warnTitle": "경고:",
  "sum.hintWrite": "변경을 적용하려면 --write 로 다시 실행하세요(원본을 두려면 --out-dir <폴더>).",
  "sum.hintVerify": "결과 확인: genai-codemod verify <전> <후>",
  "sum.wrote": "저장: {path}",
  "v.title": "요청 동등성: {before} 대 {after}",
  "v.mode": "목 응답: {response}{vertex}",
  "v.vertexSuffix": ", Vertex 인증 주입",
  "v.requests": "보낸 요청 수: {before} 대 {after}",
  "v.rules": "적용한 정규화 규칙:",
  "v.rule.role": "systemInstruction.role 은 무시합니다(구 SDK 는 \"system\", 새 SDK 는 \"user\" 를 보내지만 서버에서는 같은 뜻)",
  "v.rule.emptyDefaults": "빈 generationConfig {} 와 빈 safetySettings [] 는 없는 것과 같습니다(구 SDK 는 항상 보냈습니다)",
  "v.rule.order": "객체 키 순서는 무시합니다",
  "v.diffs": "차이:",
  "v.resultMatch": "결과: MATCH - 두 버전이 같은 요청을 보내고 같은 값을 돌려줍니다",
  "v.resultMismatch": "결과: MISMATCH - 차이 {count}개",
  "v.mockNote": "연습용 목: 실제 SDK 가 돌았지만 요청은 컴퓨터 밖으로 나가지 않았습니다. 요청이 같다는 것을 보일 뿐, 서버가 받아들이는지는 보증하지 않습니다.",
  "todo.dynamic-model-params": "모델 인자가 단순 객체 리터럴이 아니라서({detail}) 바꾸지 않았습니다. 호출마다 직접 옮기세요: ai.models.generateContent({ model, contents, config }).",
  "todo.handle-escapes": "모델 핸들이나 결과가 코드가 따라갈 수 없는 방식으로 쓰입니다({detail}). 핸들은 그대로 두었습니다. 모델 이름과 설정을 각 호출에 직접 넘기세요.",
  "todo.text-throws-on-block": "response.text() 는 차단된 응답에서 예외를 던졌지만 새 .text 는 undefined 를 돌려줍니다. 코드는 바꿨지만 이 try/catch 는 더 이상 차단 응답을 잡지 못합니다 - 종료 사유나 undefined 를 확인하세요.",
  "todo.stream-aggregate": "await r.response(스트림 합본)는 새 SDK 에 없습니다. 순회하면서 조각을 직접 모아 처리하세요.",
  "todo.server-managers": "@google/generative-ai/server 의 캐시·파일 매니저는 자동 변환하지 않습니다. @google/genai 의 ai.caches.*, ai.files.* 로 직접 옮기세요.",
  "todo.request-options": "요청 옵션(타임아웃, baseUrl, 추가 인자)은 옮기지 않고 그대로 두었습니다. GoogleGenAI 생성자의 httpOptions 로 직접 옮기세요.",
  "todo.vertex-function-schema": "Vertex 함수 선언 스키마(function_declarations, FunctionDeclarationSchemaType)는 바꾸지 않았습니다. @google/genai 의 functionDeclarations 와 Type 열거형으로 직접 옮기세요.",
  "todo.vertex-preview": "vertexAI.preview.* 는 자동 변환하지 않습니다. @google/genai 의 해당 ai.* 서비스로 직접 옮기세요.",
  "todo.unsupported-usage": "이 사용 방식은 자동 변환하지 않습니다({detail}). 그대로 두었습니다. @google/genai 이전 가이드를 확인하세요.",
  "todo.unsupported-import-form": "이 import 형태(네임스페이스·default·모듈 전체 require)는 바꾸지 않았습니다. 필요한 이름을 @google/genai 에서 직접 import 하세요.",
  "todo.cross-module": "{name} 은(는) {module} 에서 가져온 것이고 여기서 아직 구 SDK 방식으로 쓰입니다({detail}). 그대로 두었습니다. 두 파일을 한 번에 검사하면(폴더를 넘기기) 공유 클라이언트를 따라가 옮깁니다. 아니면 이 호출을 ai.models.* 로 직접 옮기세요.",
  "todo.client-exported": "이 클라이언트는 \"{name}\" 으로 export 되고 새 SDK 로 바뀌었지만, 검사한 파일 중 이것을 import 하는 파일이 없습니다. import 하는 파일은 여전히 getGenerativeModel() 을 불러 깨집니다. 그 파일들도 같은 실행에서 검사하거나(폴더를 넘기기) 직접 옮기세요.",
  "warn.client-shared": "이 클라이언트는 \"{name}\" 으로 export 됩니다. 이것을 import 하는 검사 대상 파일 {count}개는 같은 실행에서 함께 처리했습니다(변환하거나 TODO 로 보고). 검사 경로 밖에서 import 하는 파일도 같은 이전이 필요합니다.",
  "warn.api-version-pinned": "구 SDK 가 쓰던 엔드포인트 버전을 보존하려고 apiVersion \"{version}\" 을 고정했습니다. @google/genai 3.x 의 기본값은 v1(Vertex: v1beta1)입니다. 기본값을 시험한 뒤 고정을 빼거나 GOOGLE_GENAI_API_VERSION 을 쓰세요.",
  "warn.api-version-default-changed": "apiVersion 을 고정하지 않았습니다: @google/genai 3.x 는 Gemini API 를 v1 로 호출하지만 구 SDK 는 v1beta 를 썼습니다. 일부 모델·별칭은 v1beta 에만 있습니다. verify 로 경로 변화를 확인하세요.",
  "warn.vertex-api-version-default-changed": "apiVersion 을 고정하지 않았습니다: @google/genai 는 Vertex AI 를 v1beta1 로 호출하지만 구 SDK 는 v1 을 썼습니다. verify --vertex 로 경로 변화를 확인하세요.",
  "warn.nested-generation-config": "config.generationConfig 는 @google/genai 가 조용히 버립니다. 키를 config 바로 아래로 옮기세요(예: config: { temperature: 0.2 }).",
  "warn.node-engine": "engines.node 가 22 미만 Node.js 를 허용하지만({range}) @google/genai 3.x 는 Node.js 22 이상이 필요합니다. engines.node 를 올리거나 이전 @google/genai 릴리스를 쓰세요.",
  "demo.step1": "1. 파일 하나로 드라이런 (diff 만 출력)",
  "demo.step2": "2. 샘플 앱을 .demo-out/ 으로 이전",
  "demo.step3": "3. verify: Gemini API 코드",
  "demo.step4": "4. verify: Vertex AI 코드",
  "demo.step5": "5. 숨은 차이: SDK 기본 API 버전에 맡기기",
  "demo.step5b": "5b. verify 가 바뀐 요청 경로를 보여 줍니다",
  "demo.step6": "6. 차단된 응답으로 verify",
  "demo.done": "완료. .demo-out/ 을 열어 이전된 파일을 확인하세요.",
  "demo.next": "다음: npm run demo:hidden 은 verify 만 잡아내는 차이 두 가지를 보여 줍니다.",
  "demo.unexpectedExit": "예상 밖의 종료 코드 {code} (기대값 {expected}).",
  "warn.duplicate-genai": "@google-cloud/vertexai 와 @google/genai 가 함께 의존성에 있습니다. 구 패키지가 자기 몫의 @google/genai 를 끌고 옵니다. 이전이 끝나면 @google-cloud/vertexai 를 제거하세요."
};
