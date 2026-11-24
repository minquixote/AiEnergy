# PRD: AI Energy Bar (개인용 AI 구독 잔여량 위젯)

## 1. 프로젝트 개요
- **목적**: macOS 메뉴바 및 Windows 시스템 트레이에서 개인이 구독 중인 ChatGPT, Gemini, Claude의 남은 사용량을 실시간 에너지바와 %로 한눈에 확인하는 경량 데스크톱 위젯.
- **대상 사용자**: 개인 단독 사용 (멀티유저·클라우드 서버·결제 기능 불필요).
- **지원 OS**: macOS (상단 메뉴바), Windows 10/11 (하단 시스템 트레이).
- **지원 플랫폼 (3종)**:
  1. ChatGPT (Plus / Pro 웹 구독)
  2. Google Gemini (AI Pro / Ultra 웹 구독)
  3. Claude (Pro / Max 웹 구독)

## 2. 비목표 (Out of Scope)
- 공식 유료 API 키 연동 및 API 종량제 요금 추적 제외.
- 외부 백엔드 서버 구축 및 클라우드 동기화 제외 (모든 세션·설정은 로컬 전용).
- 앱스토어 배포·서명·자동 결제 기능 제외.

## 3. 기술 스택
- **프레임워크**: Electron + TypeScript + React + Tailwind CSS (Vite 기반, 예: `electron-vite`).
- **상태 및 로컬 저장**: `electron-store` (설정 및 마지막 조회 캐시 저장).
- **세션 관리**: Electron `session.fromPartition('persist:<provider>')`을 플랫폼별로 분리해 로그인 쿠키 유지.
- **빌드**: `electron-builder` (macOS `.dmg`, Windows `.exe` / portable).

## 4. 핵심 기능 요구사항

### 4.1 트레이 / 메뉴바 아이콘 및 팝오버 UI
- **상주 형태**: 앱 실행 시 macOS 메뉴바 / Windows 시스템 트레이에 아이콘 표시 (Dock/작업표시줄 아이콘은 기본 숨김).
- **트레이 요약 표시**:
  - macOS 메뉴바: 활성화된 모든 플랫폼에 대해 왼쪽 플랫폼 구분 아이콘(ChatGPT / Gemini / Claude) + 오른쪽 배터리/에너지 그래픽을 나란히 표시하며, 그래픽 내부에 잔여 `%` 숫자와 구간별 색상을 반영 (설정에서 `%` 숫자 표시 토글 지원).
  - Windows 트레이: 단일 슬롯 환경에 맞춰 활성 플랫폼 중 가장 낮은 잔여량 기준 배터리 아이콘 및 전체 요약 툴팁 표시.
- **팝오버 카드 (너비 약 340px, 다크 모드 기본 / OS 테마 연동)**:
  - 상단 헤더: 앱 이름, 수동 새로고침 버튼, 마지막 업데이트 시각(예: `방금 업데이트됨` / `5분 전`), 설정(로그인 관리) 버튼.
  - 플랫폼 카드 3개 (ChatGPT, Gemini, Claude) 세로 배치:
    - **플랫폼명 + 상태 배지** (연동됨 / 재로그인 필요 / 조회 실패).
    - **세션 잔여 에너지바 + %**: `남은 사용량 = 100% - 사용됨%` (예: `48% 남음`).
    - **초기화 시각 & 카운트다운**: 플랫폼 제공 초기화 시각(예: `오전 12:18 초기화`)과 로컬 타이머 기반 남은 시간 표시.
    - **주간 한도 요약 줄**: 주간 남은 % 및 초기화 일시 (예: `주간 99% 남음 · 12/1 오후 8:18 초기화`).

### 4.2 에너지바 색상 및 알림 기준 (남은 사용량 기준)
- **51% ~ 100%**: 초록색 (여유)
- **21% ~ 50%**: 노란색/주황색 (주의)
- **0% ~ 20%**: 빨간색 (경고)
- **OS 데스크톱 알림**: 특정 플랫폼의 세션 잔여량이 `20% 이하`로 처음 진입하거나 `초기화 완료(100% 회복)` 시 1회 알림 발송 (설정에서 켜고 끄기 가능).

### 4.3 로그인 및 데이터 수집 (Provider 어댑터 구조)
- **1회 로그인 흐름**:
  - 설정 화면에서 각 플랫폼의 `[로그인 / 연결]` 버튼 클릭 시 해당 플랫폼 전용 `BrowserWindow` (`persist:chatgpt`, `persist:gemini`, `persist:claude`)를 띄워 사용자가 직접 공식 페이지에서 로그인.
  - 로그인 완료 후 창을 닫아도 세션 쿠키가 로컬에 유지됨.
- **백그라운드 사용량 수집**:
  - 플랫폼별 독립 어댑터(`src/main/providers/chatgpt.ts`, `gemini.ts`, `claude.ts`)로 분리.
  - 숨김 `BrowserWindow`(`show: false`)에서 각 플랫폼의 사용량 한도 페이지를 로드하고, 네트워크 응답 JSON 가로채기(우선) 또는 DOM 텍스트 파싱(보조)으로 `%` 및 초기화 시각 추출.
  - 추출 데이터 공통 인터페이스:
    ```ts
    export interface ProviderUsage {
      id: 'chatgpt' | 'gemini' | 'claude';
      status: 'ok' | 'auth_required' | 'error';
      sessionRemainingPct: number | null; // 0 ~ 100
      sessionResetAt: string | null;      // 원문 또는 ISO 시각
      weeklyRemainingPct: number | null;  // 0 ~ 100
      weeklyResetAt: string | null;
      updatedAt: number;                  // timestamp
      errorMessage?: string;
    }
    ```
- **갱신 주기 및 안전장치**:
  - 자동 갱신: 기본 **10분 간격** (설정에서 1/5/10/15분 변경 가능).
  - 수동 새로고침 쿨다운: 연속 클릭으로 인한 429 차단을 막기 위해 최소 30초 쿨다운 적용.
  - 세션 만료/봇 차단 감지 시: 크래시 없이 카드 상태를 `재로그인 필요`로 전환하고, 카드 클릭 시 해당 로그인 창을 바로 열도록 처리.

## 5. 단계별 개발 계획 (MVP 우선)
- **Phase 1 (뼈대 & UI)**: Electron 트레이/메뉴바 + 팝오버 창 + Mock 데이터 기반 에너지바 UI (초록/노랑/빨강 색상 전환, 다크모드, 로컬 설정 저장).
- **Phase 2 (1개 플랫폼 실연동 검증)**: Gemini 또는 Claude 1개 플랫폼에 대해 `persist:` 로그인 창 + 백그라운드 사용량 파싱 + 재로그인 흐름 완성.
- **Phase 3 (나머지 2개 플랫폼 확장)**: 나머지 2개 플랫폼 어댑터 추가 및 20% 이하 OS 알림 구현.
- **Phase 4 (패키징 & 안정화)**: macOS/Windows 빌드 설정, 부팅 시 자동 실행 옵션, 파서 오류 디버그 로그 뷰어 추가.
