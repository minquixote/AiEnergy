# AI Energy Bar

macOS 메뉴바 및 Windows 시스템 트레이에서 개인이 구독 중인 ChatGPT, Gemini, Claude의 남은 사용량을 실시간 에너지바와 `%`로 확인하는 경량 데스크톱 위젯입니다.

자세한 기획 문서는 [prd.md](./prd.md)를 참고하세요.

## 개발 실행 (macOS / Windows)

Node.js 22 이상과 npm이 필요합니다.

```bash
npm install
npm run dev
```

### 실연동 (`LIVE`) 설정 방법
1. **ChatGPT (Plus / Pro)**
   - Mac에 Codex CLI(`~/.codex/auth.json`)가 로그인되어 있으면 자동 연동됩니다.
   - 또는 **ChatGPT 카드 클릭 → `[1. 기본 브라우저에서 세션 열기]` → 전체 복사(`Cmd+A`, `Cmd+C`) → 붙여넣기(`Cmd+V`) → `[세션 연결]`** (로컬 키체인 암호화 저장).
2. **Google Gemini (AI Pro / Ultra)**
   - **Gemini 카드 클릭 → `[1. 브라우저에서 gemini.google.com/usage 열기]`**
   - 브라우저 개발자 도구(`⌥⌘I`) → **Network** 탭 → 새로고침(`⌘R`) → `executeQuery` 요청 우클릭 → **Copy → Copy as cURL** (또는 Cookie 헤더 복사) → 붙여넣기 → **`[Gemini 연결]`**.
3. **Claude (Pro / Max)**
   - **Claude 카드 클릭** 후 `sessionKey` / `Copy as cURL` 붙여넣기 또는 앱 내 이메일 로그인 창으로 연결할 수 있으며, 미구독 시 설정에서 숨길 수 있습니다.
4. **OS 데스크톱 알림 & 로그인 시 자동 실행**
   - 활성화된 플랫폼의 세션 잔여량이 **20% 이하로 최초 진입**하거나 **100%로 초기화 회복** 시 1회 데스크톱 알림을 발송합니다.
   - 설치 앱(`.dmg`/`.exe`) 실행 후 **설정 → 로그인 시 자동 실행** 토글을 켜면 OS 부팅/로그인 시 메뉴바에서 자동으로 시작됩니다.
5. **진단 및 디버그 로그**
   - **설정 → 진단 및 디버그 로그**에서 최근 60건의 수집 전략·HTTP 상태·오류 내역을 확인하고 클립보드에 복사할 수 있습니다. (쿠키·토큰·이메일 등 민감 정보는 저장 및 복사 전 자동 마스킹)

## 배포 패키지 빌드 (macOS `.dmg` / Windows `.exe`)

```bash
# macOS Apple Silicon (M1~M4) 전용 .dmg + .zip 생성 (release/ 폴더 출력)
npm run dist:mac:arm64

# macOS Universal용 (arm64 + x64) .dmg + .zip 생성
npm run dist:mac

# Windows NSIS 설치 프로그램 + Portable 실행 파일 생성 (Windows 환경에서 실행)
npm run dist:win
```

### GitHub Actions로 원클릭 빌드 (맥에서도 Windows `.exe` 생성 가능)
- GitHub 저장소 상단 **Actions → Build Installers (Windows & macOS) → Run workflow**를 클릭하면 `windows-latest` / `macos-latest` 러너에서 Windows `.exe`(설치형 + 무설치 포터블)와 macOS `.dmg`가 자동 빌드되어 **Artifacts**에서 바로 다운로드할 수 있습니다.
- Windows 10/11에서는 16×16 정사각 트레이 아이콘과 함께 화면 구석에 드래그 가능한 **항상 위 미니 바**를 제공하며, Chrome/Edge 개발자 도구의 `Copy as cURL (cmd / bash)` 및 `Copy as PowerShell`을 모두 지원합니다.

> **macOS 개인용(미서명) 빌드 설치 안내**: `electron-builder.yml`은 Apple 유료 개발자 인증서 없이 로컬 빌드할 수 있도록 `identity: null`로 설정되어 있습니다. 생성된 `release/*.dmg`에서 `AI Energy Bar.app`을 `응용 프로그램(Applications)` 폴더로 드래그한 뒤 실행할 때 보안 경고가 뜨면 **앱 우클릭 → 열기** 또는 터미널에서 `xattr -cr "/Applications/AI Energy Bar.app"`을 1회 실행해 주세요.
>
> **Windows 개인용(미서명) 빌드 설치 안내**: Windows SmartScreen에서 *"Windows의 PC 보호"* 창이 뜰 경우 **추가 정보 → 실행**을 클릭해 실행할 수 있습니다.

## 주요 스크립트

```bash
npm run typecheck      # Main/Preload + Renderer TypeScript 검사
npm test               # Vitest 단위 테스트
npm run build          # 프로덕션 번들 빌드 (out/)
npm run dist:mac:arm64 # Apple Silicon macOS .dmg / .zip 패키징 (release/)
npm run dist:mac       # macOS arm64 + x64 패키징 (release/)
npm run dist:win       # Windows NSIS / Portable 패키징 (release/)
```

## 제작자

- **김영민** ([kimym@me.com](mailto:kimym@me.com))