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
2. 팝오버에서 **ChatGPT** 카드(`재로그인 필요`)를 클릭하면 전용 세션(`persist:chatgpt`) 로그인 창이 열립니다.
3. 공식 ChatGPT 계정으로 로그인 완료 후 로그인 창을 닫으면 백그라운드 숨김 창이 `/backend-api/wham/usage` JSON(우선) 또는 사용량 페이지 DOM(보조)을 읽어 남은 `%`, 초기화 카운트다운, 주간 한도를 즉시 반영합니다.
4. macOS 상단 메뉴바에는 활성화된 모든 플랫폼이 `[플랫폼 아이콘] [배터리 %]` 형태로 나란히 표시됩니다.
5. 아직 미연동 플랫폼(Gemini/Claude)은 설정에서 숨기거나, 설정의 **데이터 소스**를 `Mock 테스트`로 전환해 UI를 확인할 수 있습니다.

## 주요 스크립트

```bash
npm run typecheck   # Main/Preload + Renderer TypeScript 검사
npm test            # Vitest 단위 테스트
npm run build       # 프로덕션 번들 빌드 (out/)
```