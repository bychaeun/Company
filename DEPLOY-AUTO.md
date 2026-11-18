# 자동 배포 설정 (Apps Script)

`main`에 올리면 다음 두 가지가 함께 배포됩니다.

| 구분 | 배포 방법 |
|---|---|
| 화면 (GitHub Pages) | 기존 방식대로 자동 배포 |
| 서버 (Apps Script) | `.github/workflows/apps-script-deploy.yml`이 **기존 웹앱 배포를 새 버전으로 업데이트**. 주소는 바뀌지 않습니다 |

배포 전에 테스트를 먼저 돌리고, 하나라도 실패하면 배포하지 않습니다.
원격 프로젝트의 `appsscript.json`(권한, 웹앱 설정)과 저장소에 없는 파일은 그대로 두고 `apps-script/*.gs` 파일만 덮어씁니다.

## 처음 한 번만 하는 설정

### 1. Apps Script API 켜기
https://script.google.com/home/usersettings 에서 **Google Apps Script API**를 **사용**으로 바꿉니다.

### 2. 내 컴퓨터에서 로그인 정보 만들기
Node.js가 설치된 컴퓨터의 터미널에서 실행합니다.

```bash
npm install -g @google/clasp@2.4.2
```

```bash
clasp login
```

브라우저가 열리면 Apps Script 프로젝트 소유 계정으로 로그인하고 허용합니다.
로그인이 끝나면 아래 파일이 생깁니다.

- Mac / Linux: `~/.clasprc.json`
- Windows: `C:\Users\<사용자이름>\.clasprc.json`

### 3. GitHub Secrets 등록
GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `CLASPRC_JSON` | `.clasprc.json` 파일 내용 **전체** |
| `APPS_SCRIPT_ID` | Apps Script 편집기 → ⚙️ 프로젝트 설정 → **스크립트 ID** |

`.clasprc.json`은 Google 계정의 Apps Script 접근 권한입니다. Secrets에만 넣고 채팅, 코드, 커밋에는 절대 붙여넣지 마세요.

### 4. 첫 배포 실행
GitHub → **Actions → Deploy Apps Script → Run workflow**를 누릅니다.
초록색 체크가 뜨면 완료입니다. 그 뒤로는 `apps-script/` 폴더가 바뀐 채로 `main`에 올라올 때마다 자동으로 배포됩니다.

## 문제 해결

| 증상 | 해결 |
|---|---|
| `CLASPRC_JSON 과 APPS_SCRIPT_ID 를 먼저 등록하세요` | 3단계 Secrets 이름과 값을 확인합니다 |
| `User has not enabled the Apps Script API` | 1단계를 다시 확인합니다 |
| `invalid_grant` / 로그인 만료 | 2단계 `clasp login`을 다시 하고 `CLASPRC_JSON`을 새 내용으로 교체합니다 |
| 배포 ID를 찾지 못함 | `config.js`의 `API_URL`이 `.../macros/s/<배포ID>/exec` 형식인지 확인합니다 |

웹앱 배포 주소는 `config.js`의 `API_URL`에서 자동으로 읽습니다. Apps Script에서 **"새 배포"**를 만들어 주소를 바꿨다면 `config.js`도 함께 바꿔야 합니다.
