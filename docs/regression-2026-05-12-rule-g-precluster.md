# 룰 G 사전 묶음 승격 — 회귀 매트릭스 (2026-05-12)

## 변경 요약

| 항목 | 값 |
|---|---|
| 커밋 | `bc07383` (master) |
| 핵심 변경 | 룰 G(`preClusterRowLane`)를 5.36 사전 단계로 승격 + `noStacking + variable unitSizes` 필터 |
| 발동 화물 | 같은 cargoId·다단금지 단 한 박스라도 true·사이즈 변동 묶음만 |
| 강제 컨테이너 배정 | 사용 X (`fixedAssignment` 미참조) |
| 알고리즘 외 변경 | 단위 테스트 4건 활성 조건 반영, 진단 자산 2종, 본문 docs 갱신 |

## 검증 항목 (10/10)

| # | 항목 | 결과 |
|---|---|---|
| 1 | 특정 cargoId(sg3-35) 하드코딩 없음 | ✅ 모든 등장은 주석·사례·테스트 데이터 |
| 2 | `fixedAssignment` / `fixedMap` 사용 없음 (5.36 신규 단계) | ✅ pool 산출에 미참조 |
| 3 | `RULE_G_DEBUG` 없이도 동일 결과 | ✅ 디버그 로그 제거 |
| 4 | production `console.log` 0건 | ✅ docstring·테스트 이름·주석만 |
| 5 | noStacking=true z 적층 위반 없음 | ✅ `tryPlaceRowLaneBundle` z=0 강제 + 첫 박스 z>0.01 시 롤백 |
| 6 | cargoId split 없음 | ✅ atomic — partial 시 전체 롤백 |
| 7 | booking split 없음 | ✅ same cargoId 만 처리, 회귀 로그 split 0 |
| 8 | `strictStackAudit` 통과 | ✅ 회귀 매트릭스 9 샘플 audit 통과 |
| 9 | `docs/algorithm-pipeline.md` 본문 룰 G 섹션 기록 | ✅ 4.5단계 안 별도 섹션 추가 |
| 10 | 9 샘플 회귀 결과 docs 저장 | ✅ 이 파일 |

## 회귀 매트릭스 (9 샘플, 미배치 회귀 0건)

| 샘플 | baseline 미배치 | 변경 후 미배치 | baseline mismatch | 변경 후 mismatch | 컨테이너 | pack 시간 |
|---|---|---|---|---|---|---|
| 1ST SG TOTAL | 0 | **0** | 8 | 8 | 40FT+20FT | 43초 |
| 2ST SG TOTAL | 0 | **0** | PASS | PASS | 40FT×2 | 정상 |
| 3ST SG TOTAL | **1 (SK GEO)** | **0** 🎉 | 29 | 28 | 40FT×2 | 487초 → **5.5초** |
| 4ST SG TOTAL | 0 | **0** | — | — | 40FT×3 | 17ms |
| 망작 SG TOTAL | 0 | **0** | — | — | 40FT+20FT | 0ms |
| 1ST HM TOTAL | 0 | **0** | PASS | PASS | — | 정상 |
| 2ST HM TOTAL | 0 | **0** | 30 | 28 | 40FT×2+20FT | 29초 |
| 3ST HM TOTAL | 0 | **0** | — | — | 40FT+20FT | 1ms |
| 4ST HM TOTAL | 0 | **0** | — | — | 40FT×3 | 103초 |

**총평**
- 미배치 회귀 **0건** (3ST SG 1→0 해결)
- mismatch 개선 2건 (3ST SG 29→28, 2ST HM 30→28)
- 회귀 추가 발생 0건
- 단위 테스트 **109/109** 통과
- pack 시간 회귀 없음 (3ST SG 88배 단축이 가장 큰 효과)

## 절대 룰 준수 확인

1. CBM 쪼개기 금지 — atomic 보호로 변경 없음 ✅
2. 점수 합산 금지 — lex comparator 그대로 ✅
3. 요청 외 코드 수정 금지 — 룰 G 영역 + 호출부 + 테스트 + docs 만 ✅
4. `algorithm.ts` 변경 시 `docs/algorithm-pipeline.md` 동시 갱신 ✅
5. 실무자 분배 ≠ 유일 정답 — mismatch 는 valid 기준 X (절대 룰 8) ✅
6. 알고리즘 외 비즈니스 추측 없음 ✅
7. 회귀 0건 보장 — 9 샘플 매트릭스로 검증 ✅

## 재현 명령

```bash
# 단위 테스트
node --test --experimental-strip-types lib/packing/*.test.ts

# 5종 baseline 회귀
node --experimental-strip-types scripts/verify-1st-sg-total.mjs
node --experimental-strip-types scripts/verify-2st-sg-total.mjs
node --experimental-strip-types scripts/verify-3st-sg-total.mjs
node --experimental-strip-types scripts/verify-hm-total.mjs
node --experimental-strip-types scripts/verify-2st-hm-total.mjs

# 추가 4 샘플
node --experimental-strip-types scripts/_regression-additional-samples.mjs

# 격리 진단 (룰 G 단독)
node --experimental-strip-types scripts/_isolate-skgeo-rule-g.mjs
```
