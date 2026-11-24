# AI Energy Bar

macOS 메뉴바 및 Windows 시스템 트레이에서 개인이 구독 중인 ChatGPT, Gemini, Claude의 남은 사용량을 실시간 에너지바와 `%`로 확인하는 경량 데스크톱 위젯입니다.

자세한 기획 문서는 [prd.md](./prd.md)를 참고하세요.

## 개발 실행 (macOS / Windows)

Node.js 22 이상과 npm이 필요합니다.

```bash
npm install
npm run dev
```

- 실행 시 Dock/작업표시줄 아이콘은 숨겨지고 macOS 상단 메뉴바(또는 Windows 트레이)에 배터리 아이콘과 최저 잔여 `%`가 표시됩니다.
- 개발 모드에서는 최초 실행 시 팝오버가 자동으로 열리며, 메뉴바 아이콘 클릭으로 팝오버를 열고 닫을 수 있습니다.
- 설정 화면에서 미구독 플랫폼(예: Claude)을 숨기거나 Mock 테스트 시나리오(여유/주의/경고/세션 만료)를 전환해 확인할 수 있습니다.

## 주요 스크립트

```bash
npm run typecheck   # Main/Preload + Renderer TypeScript 검사
npm test            # Vitest 단위 테스트
npm run build       # 프로덕션 번들 빌드 (out/)
```