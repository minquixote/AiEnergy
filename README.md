# AI Energy Bar

macOS 메뉴바 및 Windows 시스템 트레이에서 개인이 구독 중인 ChatGPT, Gemini, Claude의 남은 사용량을 실시간 에너지바와 `%`로 확인하는 경량 데스크톱 위젯입니다.

자세한 기획 문서는 [prd.md](./prd.md)를 참고하세요.

## 개발 실행 (macOS / Windows)

Node.js 22 이상과 npm이 필요합니다.

```bash
npm install
npm run dev
```

### Phase 2 (ChatGPT Pro 실연동) 테스트 방법
1. 앱 실행 시 기본 모드는 **실연동 (`LIVE`)** 으로 시작합니다.
2. Mac에 OpenAI Codex CLI(`~/.codex/auth.json`)가 로그인되어 있으면 **자동 인식**해 즉시 실시간 잔여량을 표시합니다.
3. Codex CLI가 없거나 Google 계정 로그인을 쓰시는 경우, **ChatGPT** 카드를 클릭해 열리는 연결 패널에서 **[1. 기본 브라우저에서 세션 열기]** → `Cmd+A`, `Cmd+C` → 입력 칸에 `Cmd+V` → **[세션 연결]** 을 누르면 macOS 키체인 암호화(`safeStorage`)로 로컬 저장되고 0.3초 만에 실시간 잔여량이 반영됩니다.
4. macOS 상단 메뉴바에는 활성화된 모든 플랫폼이 `[플랫폼 아이콘] [배터리 %]` 형태로 나란히 표시됩니다.
5. 아직 미연동 플랫폼(Gemini/Claude)은 설정에서 숨기거나, 설정의 **데이터 소스**를 `Mock 테스트`로 전환해 UI를 확인할 수 있습니다.

## 주요 스크립트

```bash
npm run typecheck   # Main/Preload + Renderer TypeScript 검사
npm test            # Vitest 단위 테스트
npm run build       # 프로덕션 번들 빌드 (out/)
```