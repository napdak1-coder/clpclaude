# 3차 단계 — Internal Residual Make-Room 결과

date: 2026-05-13
status: opt-in 실험 구현 및 1차 검증 완료

## 변경 범위

- production 기본 경로 변경 없음
- `residualMakeRoom.enabled=true` 일 때만 실행
- residual cargo를 넣기 위해 단일 컨테이너 내부에서 제한된 cargoId conflict set만 제거
- 제거 단위는 cargoId 전체이며, 성공 시 residual cargo를 먼저 배치하고 제거 cargo를 다시 배치
- 실패 시 snapshot rollback

## 제한값

- maxRemoveCargoIds: 3
- maxRemoveUnits: 12
- maxTargetsPerCargo: 50
- timeBudgetMs: 60,000

## 검증 결과

| sample | E3 base unplaced | residual make-room 결과 | 새로 배치 | bookingSplit | cargoSplit | audit | hardCbm | weightOver | packTime |
|---|---:|---:|---|---:|---:|---|---:|---:|---:|
| sg-1 | 1 (sg-1-14) | 1 (sg-1-14) | - | 0 | 0 | PASS | 0 | 0 | 11.8s |
| sg-4 | 1 (sg-4-4) | 0 | sg-4-4 | 0 | 0 | PASS | 0 | 0 | 19.9s |
| sg-5 | 2 (sg-5-17, sg-5-35) | 1 (sg-5-35) | sg-5-17 | 0 | 0 | PASS | 0 | 0 | 62.9s |

## 판단

- `sg-4-4`는 bounded local make-room으로 해결됨.
- `sg-5-17`도 bounded local make-room으로 해결됨.
- `sg-1-14`는 local make-room 문제가 아니라 candidateUnion / container-set flow 쪽 문제로 보임.
- `sg-5-35`는 남아 있으며, 60초 budget 안에서 현재 conflict 후보로는 해결 안 됨.

## 다음 후보

- `sg-5-35`: target 후보 생성 방식 강화 또는 heavier/large-footprint 전용 make-room 필요.
- `sg-1-14`: `packBestWithCandidateUnion`의 time-budget / single-strategy wrapper 또는 candidate-set 선택 흐름 쪽에서 재현 필요.
- production 반영은 아직 보류. 현재 구현은 opt-in 실험 플래그로 유지.

