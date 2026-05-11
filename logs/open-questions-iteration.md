# sg3-11 iteration loop — 사용자 확인 필요 항목

> 작성: 2026-05-08 (Planner)
> 본문 plan: `logs/iteration-master-plan.md`

## 사용자 답변 대기 (4 항)

- [ ] **Q1. 시간 한계 초과 시** — 1 trial 당 환경 한계(8분) 초과 시
  - (a) 강제 종료 + 다음 후보로
  - (b) lightMode 로 재시도
  - (c) 사용자에게 매번 묻기
  - 영향: 시간 효율 vs 정확도

- [ ] **Q2. 수학적 infeasible 증명 시 종료 시점** — 형제 수학자가 infeasible 보고하면
  - (a) 즉시 종료 (시간 절약)
  - (b) 1~2 trial 더 시도 후 종료 (확신 강화)
  - 영향: 시간 절약 vs 확신

- [ ] **Q3. 후보 list 소진 후** — 단계 2 의 후보 list (A~F) + 형제 추가안 모두 소진 시
  - (a) 자동 종료 + 사용자에게 옵션 ①②③ 제시
  - (b) Architect / Scientist 재dispatch (깊은 탐색)
  - 영향: 깊이 vs 시간

- [ ] **Q4. trial 채택 시 commit 시점** — 통과 기준 모두 PASS 한 trial 발견 시
  - (a) 자동 commit + 사용자 보고
  - (b) 사용자 승인 대기 후 commit
  - 영향: 자동성 vs 안전

## 답변 형식

> 사용자: "Q1=a, Q2=a, Q3=a, Q4=b" (또는 한국어 자연어 OK)

답변 후 본문 plan §3 종료 조건 + §6 Open Questions 갱신.
