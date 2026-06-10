# Notion LLM 위키 — 초기 세팅 계획서

> 인터뷰(grill-me)로 확정한 결정을 기반으로 한 셋업 TODO 리스트.

## 0. 확정된 결정 (이게 모든 전제다)

| 항목 | 결정 | 이유 |
|---|---|---|
| 제품 | Notion에 쌓인 노트를 "LLM 위키"처럼 활용해주는 앱 | 요즘 다 노션 쓰니까, 기존 축적 데이터를 살림 |
| 타겟 | (최종) 일반 노션 사용자 / (지금) 나 자신 도그푸딩 | 검증 먼저, 일반인 SaaS는 나중 |
| 셸 | **Next.js 단일 (App Router)** — Electron ❌, React+Nest ❌ | 데이터가 클라우드(Notion)라 fs 불필요 + 내 최강 스킬 + 설치 0 |
| 모노레포 | **pnpm workspaces** (`apps/web` + `packages/core`만) | 최소로 시작, core는 나중 Nest 분리 대비 |
| DB | **Supabase Postgres + Prisma** | 웹/서버리스라 로컬 SQLite 불가, SaaS로 매끄럽게 성장 |
| 소스 연동 | **Notion API** (`SourceConnector` 인터페이스로 추상화) | Notion 먼저, 나중 다른 소스는 커넥터 추가로 |
| 인증 | **v1 없음** — 내 integration 토큰을 `.env`에 | OAuth/로그인은 멀티유저 단계로 미룸 |
| LLM | **BYOK Claude** — v1은 내 키를 `.env`에 (서버사이드 호출) | 키 입력 UI는 멀티유저 때 |
| 쓰기 정책 | **v1 read-only** — Notion에 다시 쓰지 않음 | 사고 원천 차단 |
| 배포 | **Vercel** | 단일 배포, 솔로 운영 |

⚠️ 기억할 것: 멀티유저(일반인 SaaS)로 가는 순간 이건 **OAuth + 결제 + 남의 데이터 보관**이 있는 진짜 웹 SaaS가 된다. 백엔드 비중이 커진다. 그건 Phase 3 이후의 일이고, 지금은 단일 사용자로 가볍게 검증한다.

---

## Phase 0 — 조사 / 스파이크 (코드 최소, 1~2일)

목표: "내가 만들 결과물이 뭔지" 손으로 느끼고, Notion API의 실제 모습을 확인한다.

- [ ] Notion에서 **internal integration 생성** → https://www.notion.so/my-integrations → 토큰(`secret_...`) 발급
- [ ] 테스트용 Notion 페이지 몇 개를 그 integration에 **공유(Connect)** (integration은 공유된 페이지만 볼 수 있음)
- [ ] 임시 스크립트(`scratch/notion-probe.ts`)로 `@notionhq/client` 써서 페이지 1개 끌어와 **JSON 구조 직접 까보기** (블록 트리가 어떻게 생겼는지 눈으로 확인)
- [ ] `notion-to-md`로 블록 → markdown 변환 시도, 결과 확인
- [ ] **rate limit / 페이지네이션 / 중첩 블록** 동작 체감 (자식 블록은 재귀로 가져와야 함)
- [ ] Karpathy식 "LLM-maintained wiki" 개념 + OpenClaw `llm-wiki` 플러그인 훑어서 **"위키 결과물"이 어떤 모습인지** 머릿속에 그림 그리기
- [ ] **Supabase 프로젝트 생성** (무료 티어), connection string 확보

> 산출물: "Notion 페이지 → markdown 텍스트"가 스크립트로 한 번 돌아가는 것. 이게 되면 Phase 1의 80%는 정해진 거다.

### ✅ Phase 0 실측 결과 (`scratch/notion-probe.ts` 로 확인 완료)

| 발견 | 수치/결론 | Phase 1 에 주는 함의 |
|---|---|---|
| **search 100개 상한** | `has_more=true`, 워크스페이스에 100+ 페이지 | 페이지 *목록*도 `next_cursor` 로 페이지네이션 필수 |
| **자체 변환기 동작** | 588줄 markdown, **미지원 블록 0** | `notion-to-md` 버리고 **자체 `blocksToMarkdown` 채택 확정** |
| **🔴 페이지 1개 = API 98회 / 34초** | 깊은 중첩(depth 5) 페이지에서 측정 | **이게 핵심 난점.** 아래 참고 |
| notion-to-md "멈춤" 정체 | 진행로그 없이 같은 깊은 재귀를 느리게 돌던 것 | 블랙박스 의존 안 함 (이미 제거) |

**🔴 가장 중요한 교훈 — Notion 에는 "페이지 통째로 가져오기" API 가 없다.**
중첩된 블록마다 `blocks.children.list` 를 따로 호출해야 한다. 그래서 깊은 페이지 1개가 98번 호출 = 34초(rate limit ~3 req/s 에 묶임). 단순 계산으로 **100개 페이지 풀 동기화 ≈ 약 1시간.** 포그라운드에서 절대 못 돌린다.

→ 이 한 가지 사실이 Phase 1 설계를 결정한다:
1. **로컬 DB 캐시 필수** — 볼 때마다 다시 못 가져온다.
2. **증분 동기화 필수** — `last_edited_time` 비교해서 *바뀐 페이지만* 다시 변환.
3. **rate limit 핸들링** — 동시성 제한(~3) + 백오프 + (나중) 백그라운드 잡.
4. 첫 풀 동기화는 시간이 걸리는 작업이라는 전제로 UX 설계 (진행률 표시 등).

---

## Phase 1 — 모노레포 + Notion 동기화 + UI (LLM 없음)

목표: Notion 페이지를 끌어와 Postgres에 캐시하고 화면에 목록/본문을 띄운다. **AI는 아직 안 붙인다.**

### 1-1. 모노레포 골격
- [ ] `pnpm init` + `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- [ ] `apps/web` = `pnpm create next-app` (App Router, TypeScript, Tailwind)
- [ ] `packages/core` = 순수 TS 패키지 (도메인 로직, 외부 의존성 최소)
- [ ] 루트 tsconfig / eslint / prettier 공유 설정

### 1-2. DB (Prisma + Supabase)
- [ ] `apps/web`에 Prisma 설치, `DATABASE_URL` = Supabase connection string
- [ ] 스키마 작성 (아래 도메인 모델 참고) → `prisma migrate dev`
- [ ] Prisma Client 싱글톤 헬퍼 작성

### 1-3. core — 소스 추상화
- [ ] `packages/core/interfaces/SourceConnector.ts` 정의
  ```ts
  interface SourceConnector {
    listPages(): Promise<RawPage[]>;          // 변경 감지용 메타 포함
    fetchPageMarkdown(id: string): Promise<string>;
  }
  ```
- [ ] `packages/core/connectors/NotionConnector.ts` 구현 (`@notionhq/client` + `notion-to-md`)
  - 나중에 `NotionOAuthConnector`, 다른 소스가 이 인터페이스로 끼워짐

### 1-4. 동기화 파이프라인
- [ ] Next route handler 또는 server action: `syncNotion()`
  - Notion `listPages()` → 각 페이지 `last_edited_time` 비교
  - **변경된 것만** `fetchPageMarkdown` → Postgres `Note` upsert
  - `SyncState`에 마지막 동기화 시각 기록
- [ ] (v1) 화면의 "동기화" 버튼으로 **수동 트리거** (자동 주기 동기화는 Phase 3)

### 1-5. UI (네 React 실력 발휘 구간)
- [ ] 노트 목록 페이지 (제목, 마지막 수정, 출처 Notion 링크)
- [ ] 노트 상세 (markdown 렌더링)
- [ ] "동기화" 버튼 + 동기화 상태 표시

> 산출물: 내 Notion을 끌어와 앱에서 목록·본문을 보는, AI 없는 인덱서. **여기까지가 네 약점(데이터 파이프라인) 정복 구간.**

---

## Phase 2 — Claude 붙이기 (요약 / 위키 생성)

목표: 캐시된 노트로 **출처 링크가 달린** 요약/위키를 생성한다.

- [ ] `packages/core/interfaces/AiClient.ts` 정의 (provider 교체 가능하게)
- [ ] `@anthropic-ai/sdk` 구현체 (`apps/web` 서버사이드, 키는 `.env`)
- [ ] usecase (`packages/core/usecases/`):
  - [ ] `summarizeNotes` — 노트 묶음 → 요약 (출처 noteId 유지)
  - [ ] `generateProjectWiki` — 특정 프로젝트/주제 노트 모아 위키 초안 생성
- [ ] 청킹(chunking) — 긴 노트를 토큰 한도 맞춰 자르고 출처 추적
- [ ] 결과를 `WikiPage`로 Postgres 저장 (status: draft), **각 문장/섹션에 출처 노트 링크**
- [ ] UI: 위키/요약 표시 + 출처 클릭 시 원본 노트로 이동
- [ ] (선택) 스트리밍 응답으로 생성 과정 보여주기

> 산출물: "내 노션 프로젝트 위키 만들어줘" → 출처 달린 위키 초안. **여기서 제품의 핵심 가치가 처음 보인다.**

---

## Phase 3+ — SaaS화 (검증된 뒤에)

여기부터 백엔드가 무거워진다. Phase 2가 "쓸만하다"고 확인된 뒤에만 착수.

- [ ] **Auth.js + Notion OAuth** (공개 integration 등록, 콜백 route, client secret은 서버에)
- [ ] 멀티유저 데이터 격리 (모든 쿼리에 `userId` 스코프)
- [ ] **BYOK 키 입력 UI** (사용자 Claude 키) 또는 Claude **프록시 + 사용량 제한**
- [ ] 결제 (Stripe / Lemon Squeezy) + 구독 상태 체크
- [ ] **자동 주기 동기화** — Vercel Cron / 큐 / 워커. 서버리스 타임아웃 한계에 부딪히면 이때 **Nest 또는 별도 워커 분리** (core 로직 그대로 이전)
- [ ] AI 결과 상태 관리 (suggested / accepted / rejected / outdated)

---

## 도메인 모델 초안 (Phase 1에서 만들 Prisma 스키마)

v1은 최소로. 과하게 모델링하지 말 것.

```prisma
model Note {           // Notion 페이지 1개 = 캐시
  id             String   @id @default(cuid())
  notionId       String   @unique
  title          String
  url            String              // Notion 원본 링크 (출처)
  markdown       String              // 변환된 본문
  lastEditedTime DateTime            // Notion의 값 → 변경 감지용
  syncedAt       DateTime @default(now())
  chunks         Chunk[]
}

model Chunk {          // 긴 노트 분할 (AI 입력 + 출처 추적 단위)
  id       String @id @default(cuid())
  noteId   String
  note     Note   @relation(fields: [noteId], references: [id])
  order    Int
  content  String
  // 나중: embedding (벡터 검색)
}

model WikiPage {       // AI 생성 결과
  id        String   @id @default(cuid())
  scope     String              // 프로젝트/주제 이름
  content   String              // 출처 링크 포함 markdown
  status    String   @default("draft")   // draft | accepted | rejected
  sources   String[]            // 출처 noteId 배열
  createdAt DateTime @default(now())
}

model SyncState {      // 동기화 메타
  id           String   @id @default("singleton")
  lastSyncedAt DateTime?
}
```

---

## 학습 우선순위 (이 순서로 부딪히며 배운다)

1. **Notion API** — integration, 블록 모델, 페이지네이션, rate limit (Phase 0)
2. **Prisma + Postgres** — 스키마, 마이그레이션, upsert (Phase 1)
3. **데이터 파이프라인 사고** — 변경 감지, 증분 동기화, 캐싱 (Phase 1)
4. **도메인 모델링** — Note/Chunk/WikiPage/출처 관계 (Phase 1~2)
5. **LLM 오케스트레이션** — 청킹, 출처 유지, 프롬프트 설계 (Phase 2)
6. **(나중) 인증/결제/멀티유저 SaaS** — OAuth, Stripe, 데이터 격리 (Phase 3)

> 핵심: 서버 백엔드 고수가 될 필요는 없다. 단, **데이터 파이프라인 + 도메인 모델링**은 제대로 익혀야 한다. Phase 3로 가면 그때 진짜 백엔드(인증/결제/멀티테넌시)를 배우게 된다.

---

## 지금 당장 할 일 (Phase 0 시작점)

1. Notion integration 토큰 발급 + 테스트 페이지 공유
2. `scratch/notion-probe.ts`로 페이지 1개 끌어와 JSON 까보기
3. `notion-to-md`로 markdown 변환 확인
4. Supabase 프로젝트 생성
