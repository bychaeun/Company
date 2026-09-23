# CHAE EUN.ZIP 비공개 운영 / 무료 배포

## 보안 구조

Google OAuth 로그인 → 신규 사용자는 접근관리 시트에 대기로 기록 → 관리자 승인 후 메모를 읽습니다.
서버에서 Google 토큰 서명, 발급자, 대상, 만료, nonce를 검증합니다.
모든 메모·이미지 API에서 승인 상태를 다시 확인하며 시트 오류 시 접근을 차단합니다.
화면의 데이터는 차단 후 최대 1분 내 지워집니다. 이미 내려받거나 캡처한 자료는 회수할 수 없습니다.

## 무료 Render 배포

GitHub Pages는 서버를 실행하지 못하므로 사용하지 않습니다.
render.yaml은 Free Web Service 설정입니다. 유료 디스크나 데이터베이스는 사용하지 않습니다.

1. Render에서 GitHub Company 저장소를 연결하여 Blueprint 또는 Docker Web Service를 만듭니다.
2. 실제 서비스 URL을 APP_ORIGIN에 입력합니다. HTTPS 주소이며 끝에 슬래시를 붙이지 않습니다.
3. 아래 환경변수를 Render 비밀 설정에 입력합니다. 키는 코드/GitHub에 올리지 않습니다.
4. 배포 후 Google 로그인 → 대기 → 관리자 승인 → 시트에서 차단까지 실제로 확인합니다.

| 환경변수 | 내용 |
|---|---|
| APP_ORIGIN | 실제 HTTPS 서비스 주소 |
| GOOGLE_CLIENT_ID | Google OAuth 웹 애플리케이션 클라이언트 ID |
| GOOGLE_CLIENT_SECRET | 해당 OAuth 비밀 값 |
| ADMIN_EMAILS | 관리자 Google 이메일 목록, 쉼표로 구분 |
| GOOGLE_SHEET_ID | COMPANY 시트 ID |
| GOOGLE_SERVICE_ACCOUNT_JSON | 서비스 계정 JSON 전체 |

무료 서버는 15분 동안 접속이 없으면 쉬며 재접속 시 지연이 있습니다.
재시작 시 로그인 세션이 사라져 재로그인이 필요하지만 승인 목록과 메모는 Sheets에 남습니다.
실행 중에는 30분마다 동기화합니다. 휴면 중 정확한 30분 실행은 보장하지 않으며 재접속 시 갱신합니다.
무료 할당량 및 초과 정책은 [공식 안내](https://render.com/docs/free)를 확인하고 지출 한도를 설정하세요.

## Google 설정 (관리자 작업 필요)

1. OAuth 동의 화면과 웹 애플리케이션 클라이언트를 생성합니다. 로그인 범위는 openid email profile입니다.
2. 리디렉션 URI에 APP_ORIGIN/auth/callback을 정확히 등록합니다. 테스트 상태라면 사용할 계정을 테스트 사용자에 추가합니다.
3. 서비스 계정을 만들고 Sheets API와 Drive API를 활성화합니다. JSON 키는 호스팅 비밀 설정에만 입력합니다.
4. COMPANY 시트를 서비스 계정에 편집자로 공유합니다. 접근관리 기록/승인 변경 때문에 편집 권한이 필요합니다.
5. 이미지용 Drive 폴더/파일은 서비스 계정에 뷰어로 공유하고 일반 액세스는 제한됨으로 유지합니다.

방문자에게 시트 자체를 공유하지 마세요. 접근관리 시트의 편집자는 권한을 부여할 수 있으므로 신뢰하는 관리자에게만 공유합니다.
ADMIN_EMAILS 계정은 Google이 검증한 Gmail 또는 Workspace 이메일이어야 합니다.
관리자 변경은 서버 설정과 SQLite 관리자 바인딩을 함께 점검해야 합니다. 비관리자의 승인 여부는 DB가 아닌 시트에 저장됩니다.

## 시트

메모 탭: 대분류 | 소분류 | 제목 | 부제목 | 내용 | 이미지 | 수정일

접근관리 탭은 첫 로그인 때 서버가 생성합니다:
Google ID | 이메일 | 이름 | 승인상태 | 최초 로그인 | 최근 로그인

헤더와 Google ID는 수정하지 마세요. 승인상태는 대기 / 승인 / 거절 / 차단 중 하나입니다.
다른 값은 승인으로 인정하지 않습니다. 관리자 계정은 환경변수 설정이 우선합니다.
로그인 기록은 최초·최근 로그인이며 모든 페이지 방문 기록은 아닙니다.

이미지 열에는 비공개 Google Drive 파일 링크를 |로 구분합니다.
PNG/JPEG/WebP/GIF 10MB 이하를 지원합니다. 외부 URL, 시트 셀 위에 직접 붙인 이미지는 현재 지원하지 않습니다.
수정일 자동 입력은 시트에 연결된 scripts/sheet-edit-date.gs의 onEdit를 사용합니다.
API 쓰기/수식 재계산은 onEdit를 실행하지 않습니다.

## 로컬

Node.js 24, pnpm 11.19.0:

```sh
pnpm --dir server install --frozen-lockfile --ignore-scripts
node --test tests/*.test.mjs
node --env-file-if-exists=.env server/index.mjs
```

기본 주소는 http://127.0.0.1:4174 입니다. .env에 위 환경변수를 입력합니다.
Google OAuth에도 로컬 리디렉션 URI를 등록해야 합니다. 자격 증명 없이는 준비 화면만 보이며 메모는 노출되지 않습니다.

기존 python/http 정적 서버로 운영하지 마세요.
과거 data/local-notes.json은 로컬 자료일 뿐 인증 보호가 없으므로 배포하지 않습니다.
시트 내용을 Git에 커밋하는 이전 Actions는 제거했습니다. Docker는 명시된 앱 파일만 포함합니다.
운영 전 실제 OAuth/시트 권한/배포 통합 확인이 필요합니다. 이 저장소에는 실제 키가 없습니다.

