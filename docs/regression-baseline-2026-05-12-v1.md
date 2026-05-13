# 회귀 baseline 2026-05-12-v1 — 🟢 활성

> 생성: 2026-05-12T11:36:33.701Z
> 커밋: `d6787fc` · 알고리즘: rule-g-precluster + attachDebug (d6787fc+)
> 스키마 v1.0.0 · 데이터 v2026-05-12-v1 · node v24.14.1

**🟢 PASS 2 · 🟡 KNOWN 3 · 🔴 FAIL 4** / 총 9건

## 9 샘플 매트릭스

| 샘플 | 상태 | 컨 셋 | 미배치·split | audit | 결정·CBM | pack 시간 | 비고 |
|---|:---:|---|:---:|:---:|---|:---:|---|
| 망작 SG | 🔴 | 40+20FT | 0 · 0/0 | ✅ | physical<br>신고 60.0<br>박스 49.9<br>기존 60.0 | · | 결정: physical |
| 1ST SG TOTAL | 🟡 | 40+20FT | 0 · 0/0 | ✅ | physical<br>신고 73.8<br>박스 73.8<br>기존 73.8 | 46.7초 | 실무자 8건 차이 · 결정: physical |
| 2ST SG TOTAL | 🟢 | 40×2FT | 0 · 0/0 | ✅ | physical<br>신고 88.8<br>박스 81.1<br>기존 88.6 | 55ms | 결정: physical |
| 3ST SG TOTAL | 🟡 | 40×2FT | 0 · 0/0 | ✅ | physical<br>신고 91.4<br>박스 85.5<br>기존 89.5 | 16.6초 | 실무자 28건 차이 · 결정: physical · 신고-기존 차 1.8m³ |
| 4ST SG TOTAL | 🔴 | 40×3FT | 0 · 0/0 | ✅ | physical<br>신고 156.3<br>박스 147.4<br>기존 156.3 | 4ms | 결정: physical |
| 1ST HM TOTAL | 🔴 | 40+20FT | 0 · 0/0 | ✅ | physical<br>신고 85.7<br>박스 29.4<br>기존 85.7 | · | 결정: physical |
| 2ST HM TOTAL | 🟡 | 40×2+20FT | 0 · 0/0 | ✅ | physical<br>신고 126.9<br>박스 111.8<br>기존 127.2 | 33.6초 | 실무자 28건 차이 · 결정: physical |
| 3ST HM TOTAL | 🟢 | 40+20FT | 0 · 0/0 | ✅ | physical<br>신고 69.5<br>박스 61.2<br>기존 69.5 | · | 결정: physical |
| 4ST HM TOTAL | 🔴 | 40×3FT | 0 · 0/0 | ✅ | physical<br>신고 137.9<br>박스 86.7<br>기존 148.6 | 172.9초 | 실무자 29건 차이 · 결정: physical · 신고-기존 차 10.6m³ |

---

**컬럼 의미**
- 상태: 🟢 PASS · 🟡 KNOWN_MISMATCH · 🔴 WIP/FAIL
- 미배치·split: 미배치 수 · cargo 분산/booking 분산
- 결정·CBM: 컨 셋 결정 근거 / 사용자 신고 / 박스 합 / 기존 알고리즘 결정용 합 (m³)
- pack 시간: 측정 3회 중 median

**Hard 동결 필드**: containerSet · unplaced · split · audit · cbm/weight overflow · physical. 변하면 회귀 fail.
**참고 필드**: userDeclared · legacy · candidates · pack 시간 · 실무자 mismatch. 변동 허용 (warning 표시).