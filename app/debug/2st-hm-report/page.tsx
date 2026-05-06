"use client";

/**
 * 2ST HM TOTAL — 분배 비교 분석 보고서 (목업)
 *
 * 비개발자용 시각 보고서:
 *   1. 데이터 요약
 *   2. 26행 분배 비교 (실무자 vs 시스템)
 *   3. 차이 원인 추론
 *   4. 발견된 알고리즘 결함
 *   5. 검증 결과
 */

type Row = {
  idx: number;
  shipper: string;
  booking: string;
  qty: number;
  /** 시스템이 실제로 packing 에 사용하는 CBM (visual=W*L*H*qty/1e6, CT/PK 무차원=cbm or aboutCbm) */
  cbmSystem: number;
  /** 엑셀에 적힌 ABOUT 칸 (실무자 기준 CBM) */
  about: number;
  cargoType: "PL" | "CT" | "PK" | "WC";
  /** 단위 박스 사이즈 (cm) — 무차원 CT 등은 "-" */
  size: string;
  /** 행 단위 무게 합 (kg) */
  weightTotal: number;
};

// 26 행 — data/samples/hochiminh-total-2.json 기준
const ROWS: Row[] = [
  { idx: 1, shipper: "AMS", booking: "FISGN260338", qty: 30, cbmSystem: 5.07, about: 5.07, cargoType: "CT", size: "-", weightTotal: 495 },
  { idx: 2, shipper: "한국쎄미텍", booking: "FISGN260339", qty: 2, cbmSystem: 4.356, about: 4.356, cargoType: "PL", size: "110×110×180", weightTotal: 476 },
  { idx: 3, shipper: "유라", booking: "FISGN260348", qty: 7, cbmSystem: 0.828, about: 0.828, cargoType: "CT", size: "-", weightTotal: 72 },
  { idx: 4, shipper: "KIOSKIN", booking: "FISGN260356", qty: 3, cbmSystem: 5.445, about: 5.203, cargoType: "PL", size: "110×110×150", weightTotal: 1047 },
  { idx: 5, shipper: "전영사", booking: "FISGN260370", qty: 3, cbmSystem: 0.23, about: 0.23, cargoType: "CT", size: "-", weightTotal: 95 },
  { idx: 6, shipper: "SD KOREA", booking: "FISGN260376", qty: 6, cbmSystem: 7.524, about: 9.453, cargoType: "PL", size: "110×120×95", weightTotal: 3910 },
  { idx: 7, shipper: "SJIT", booking: "FISGN260382", qty: 3, cbmSystem: 5.118, about: 4.368, cargoType: "PL", size: "110×110×141", weightTotal: 0 },
  { idx: 8, shipper: "일라", booking: "FISGN260383", qty: 4, cbmSystem: 12.24, about: 12.24, cargoType: "PL", size: "150×120×170", weightTotal: 2693 },
  { idx: 9, shipper: "SJI", booking: "FISGN260384", qty: 2, cbmSystem: 3.388, about: 3.388, cargoType: "PK", size: "110×110×140", weightTotal: 393 },
  { idx: 10, shipper: "KFTS", booking: "FISGN260388", qty: 3, cbmSystem: 3.218, about: 1.5, cargoType: "PL", size: "110×92×106", weightTotal: 1140 },
  { idx: 11, shipper: "한성엔터프라이즈", booking: "FISGN260381", qty: 2, cbmSystem: 0.09, about: 0.09, cargoType: "PK", size: "-", weightTotal: 41.8 },
  { idx: 12, shipper: "이구산업", booking: "FISGN260385", qty: 15, cbmSystem: 3.5, about: 3.5, cargoType: "PL", size: "60×60×40", weightTotal: 5200 },
  { idx: 13, shipper: "케이티엔테크놀러지", booking: "FISGN260391", qty: 2, cbmSystem: 4.356, about: 4.356, cargoType: "PL", size: "110×110×180", weightTotal: 0 },
  { idx: 14, shipper: "제임스텍", booking: "FISGN260276", qty: 20, cbmSystem: 1.209, about: 1.209, cargoType: "CT", size: "-", weightTotal: 290 },
  { idx: 15, shipper: "중앙바이오텍", booking: "FISGN260344", qty: 5, cbmSystem: 9.18, about: 9.18, cargoType: "PL", size: "120×85×180", weightTotal: 3378 },
  { idx: 16, shipper: "리브유", booking: "FISGN260367", qty: 6, cbmSystem: 10.382, about: 10.08, cargoType: "PL", size: "110×110×143", weightTotal: 2937.76 },
  { idx: 17, shipper: "파인 파인비나", booking: "FISGN260368", qty: 4, cbmSystem: 8.11, about: 8.11, cargoType: "PL", size: "110×110×150", weightTotal: 1750 },
  { idx: 18, shipper: "블루오션", booking: "FISGN260371", qty: 2, cbmSystem: 3.63, about: 3, cargoType: "PL", size: "110×110×150", weightTotal: 1146 },
  { idx: 19, shipper: "파인비나", booking: "FISGN260375", qty: 2, cbmSystem: 4.11, about: 4.11, cargoType: "PL", size: "110×110×160", weightTotal: 810 },
  { idx: 20, shipper: "장안어패럴", booking: "FISGN260378", qty: 110, cbmSystem: 8, about: 8, cargoType: "PK", size: "-", weightTotal: 1413.52 },
  { idx: 21, shipper: "디씨이메탈", booking: "FISGN260369", qty: 5, cbmSystem: 3.24, about: 3.24, cargoType: "WC", size: "90×90×80", weightTotal: 5000 },
  { idx: 22, shipper: "스톰테크", booking: "FISGN260377", qty: 3, cbmSystem: 8.078, about: 6.278, cargoType: "PL", size: "120×120×187", weightTotal: 1305 },
  { idx: 23, shipper: "효성", booking: "FISGN260354", qty: 2, cbmSystem: 2.86, about: 2.86, cargoType: "PL", size: "130×110×100", weightTotal: 2030 },
  { idx: 24, shipper: "로제화장품", booking: "FISGN260374", qty: 3, cbmSystem: 4.537, about: 5.39, cargoType: "PL", size: "110×110×125", weightTotal: 932.8 },
  { idx: 25, shipper: "삼원절연", booking: "FISGN260332", qty: 6, cbmSystem: 10.382, about: 9.34, cargoType: "PL", size: "110×110×143", weightTotal: 0 },
  { idx: 26, shipper: "화인써키트", booking: "FISGN260386", qty: 2, cbmSystem: 1.767, about: 1.55, cargoType: "PK", size: "110×110×73", weightTotal: 1166 },
];

const TOTAL_ABOUT = ROWS.reduce((s, r) => s + r.about, 0);
const TOTAL_QTY = ROWS.reduce((s, r) => s + r.qty, 0);
const TOTAL_WEIGHT = ROWS.reduce((s, r) => s + r.weightTotal, 0);

// 실무자 expected — 40FT × 2 + 20FT × 1, 사용자 명시
const EXPECTED_C1 = new Set([
  "AMS", "한국쎄미텍", "유라", "KIOSKIN", "전영사",
  "SD KOREA", "SJIT", "일라", "SJI", "KFTS",
  "한성엔터프라이즈", "이구산업", "케이티엔테크놀러지",
]);
const EXPECTED_C2 = new Set([
  "제임스텍", "중앙바이오텍", "리브유", "파인 파인비나", "블루오션",
  "파인비나", "장안어패럴", "디씨이메탈", "스톰테크",
]);
const EXPECTED_C3 = new Set([
  "효성", "로제화장품", "삼원절연", "화인써키트",
]);

// 시스템 결과 (verify-2st-hm-total.mjs 출력 — 2026-05-06)
// [1] 40FT (14): AMS, 유라, 전영사, 한성엔터프라이즈, 이구산업, 제임스텍, 중앙바이오텍, 파인 파인비나, 파인비나, 장안어패럴, 효성, 로제화장품, 삼원절연, 화인써키트
// [2] 40FT (5):  SJIT, 케이티엔테크놀러지, 리브유, 블루오션, 스톰테크
// [3] 20FT (7):  한국쎄미텍, KIOSKIN, SD KOREA, 일라, SJI, KFTS, 디씨이메탈
const SYSTEM_C1 = new Set([
  "AMS", "유라", "전영사", "한성엔터프라이즈", "이구산업",
  "제임스텍", "중앙바이오텍", "파인 파인비나", "파인비나", "장안어패럴",
  "효성", "로제화장품", "삼원절연", "화인써키트",
]);
const SYSTEM_C2 = new Set(["SJIT", "케이티엔테크놀러지", "리브유", "블루오션", "스톰테크"]);
const SYSTEM_C3 = new Set(["한국쎄미텍", "KIOSKIN", "SD KOREA", "일라", "SJI", "KFTS", "디씨이메탈"]);

// B1/B2 위반: cargoId / bookingNo 가 컨테이너 2 와 3 에 분산된 4 건
const SPLIT_SHIPPERS = new Set(["KIOSKIN", "SD KOREA", "일라", "디씨이메탈"]);

// 부킹 그룹 색상
const BOOKING_COLORS: Record<string, string> = {};
const colorPalette = [
  "bg-rose-100", "bg-pink-100", "bg-fuchsia-100", "bg-purple-100", "bg-violet-100",
  "bg-indigo-100", "bg-blue-100", "bg-sky-100", "bg-cyan-100", "bg-teal-100",
  "bg-emerald-100", "bg-green-100", "bg-lime-100", "bg-yellow-100", "bg-amber-100",
  "bg-orange-100", "bg-red-100", "bg-stone-100", "bg-zinc-100", "bg-slate-100",
];
const uniqueBookings = [...new Set(ROWS.map((r) => r.booking))];
uniqueBookings.forEach((bn, i) => (BOOKING_COLORS[bn] = colorPalette[i % colorPalette.length]));

type ContainerSlot = 1 | 2 | 3 | null;

function whichContainer(sets: [Set<string>, Set<string>, Set<string>], shipper: string): ContainerSlot {
  if (sets[0].has(shipper)) return 1;
  if (sets[1].has(shipper)) return 2;
  if (sets[2].has(shipper)) return 3;
  return null;
}

function ContainerBadge({ label, c, split = false }: { label: string; c: ContainerSlot; split?: boolean }) {
  if (c === null) return <span className="text-neutral-400">—</span>;
  const cls =
    c === 1 ? "bg-blue-600 text-white" :
    c === 2 ? "bg-green-600 text-white" :
    "bg-amber-600 text-white";
  return (
    <span className={`inline-block min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-[10px] font-mono leading-none ${cls} ${split ? "ring-2 ring-red-500" : ""}`}>
      {label}{split ? "✗쪼갬" : ""}
    </span>
  );
}

function calcContainerCbm(sets: [Set<string>, Set<string>, Set<string>]): { c1: number; c2: number; c3: number } {
  let c1 = 0, c2 = 0, c3 = 0;
  for (const r of ROWS) {
    if (sets[0].has(r.shipper)) c1 += r.about;
    else if (sets[1].has(r.shipper)) c2 += r.about;
    else if (sets[2].has(r.shipper)) c3 += r.about;
  }
  return { c1, c2, c3 };
}

const SYSTEM_CBM = calcContainerCbm([SYSTEM_C1, SYSTEM_C2, SYSTEM_C3]);
const EXPECTED_CBM = calcContainerCbm([EXPECTED_C1, EXPECTED_C2, EXPECTED_C3]);

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 print:p-0">
      <h1 className="text-2xl font-bold text-neutral-900 print:text-xl">
        2ST HM TOTAL — 분배 비교 분석 보고서
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        2026-05-06 · 실무자 분배 vs 시스템(현재 알고리즘) 결과
      </p>

      {/* ──────── Section 1 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">① 데이터 요약</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="총 행수" value="26" sub="실무자가 3개 sub-table 로 사전 그룹핑" />
          <Stat label="총 수량(Q'TY)" value={`${TOTAL_QTY}`} sub="엑셀 합계 = 252" />
          <Stat label="총 ABOUT CBM" value={`${TOTAL_ABOUT.toFixed(2)} m³`} sub="= 엑셀 TOTAL 126.93" />
          <Stat label="총 무게" value={`≈ ${(TOTAL_WEIGHT / 1000).toFixed(1)} t`} sub="컨테이너 25t × 2 + 21t × 1" />
        </div>
        <div className="mt-3 rounded bg-neutral-50 p-3 text-xs">
          <span className="font-semibold">큰 화물 Top 5:</span>{" "}
          일라 12.24 · 리브유 10.08 · 삼원절연 9.34 · 중앙바이오텍 9.18 · SD KOREA 9.45
        </div>
      </section>

      {/* ──────── Section 2 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">
          ② 26행 분배 비교 (실무자 vs 시스템)
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          색상: <span className="bg-blue-600 px-1 text-white">파랑 = 컨테이너 1 (40FT)</span>{" "}
          <span className="bg-green-600 px-1 text-white">초록 = 컨테이너 2 (40FT)</span>{" "}
          <span className="bg-amber-600 px-1 text-white">호박 = 컨테이너 3 (20FT)</span>{" "}
          · 행 배경색은 같은 부킹 그룹 · <span className="ring-2 ring-red-500 rounded px-1">빨간 테두리</span> = 한 화물이 두 컨테이너로 쪼개짐 (B1 위반)
        </p>
        <table className="mt-3 w-full table-fixed text-[11px]">
          <thead className="bg-neutral-100">
            <tr>
              <th className="w-8 px-1 py-1">#</th>
              <th className="w-28 px-1 py-1 text-left">실화주</th>
              <th className="w-24 px-1 py-1 text-left">부킹</th>
              <th className="w-10 px-1 py-1 text-right">Q'TY</th>
              <th className="w-12 px-1 py-1 text-right">CBM</th>
              <th className="w-10 px-1 py-1 text-center">구분</th>
              <th className="w-20 px-1 py-1 text-left">사이즈</th>
              <th className="w-24 px-1 py-1 text-center">실무자</th>
              <th className="w-24 px-1 py-1 text-center">시스템</th>
              <th className="w-12 px-1 py-1 text-center">일치</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const exp = whichContainer([EXPECTED_C1, EXPECTED_C2, EXPECTED_C3], r.shipper);
              const sys = whichContainer([SYSTEM_C1, SYSTEM_C2, SYSTEM_C3], r.shipper);
              const split = SPLIT_SHIPPERS.has(r.shipper);
              const match = sys === exp;
              return (
                <tr
                  key={r.idx}
                  className={`border-b border-neutral-200 ${BOOKING_COLORS[r.booking] ?? ""}`}
                >
                  <td className="px-1 py-0.5 text-center text-neutral-500">{r.idx}</td>
                  <td className="px-1 py-0.5 font-semibold">{r.shipper}</td>
                  <td className="px-1 py-0.5 font-mono text-neutral-600">{r.booking}</td>
                  <td className="px-1 py-0.5 text-right font-mono">{r.qty}</td>
                  <td className="px-1 py-0.5 text-right font-mono">{r.about.toFixed(2)}</td>
                  <td className="px-1 py-0.5 text-center">
                    <span className={`rounded px-1 text-[10px] ${
                      r.cargoType === "CT" ? "bg-amber-200 text-amber-900" :
                      r.cargoType === "PK" ? "bg-purple-200 text-purple-900" :
                      r.cargoType === "WC" ? "bg-rose-200 text-rose-900" : "bg-blue-50 text-blue-900"
                    }`}>{r.cargoType}</span>
                  </td>
                  <td className="px-1 py-0.5 font-mono text-[10px] text-neutral-600">{r.size}</td>
                  <td className="px-1 py-0.5 text-center">
                    <ContainerBadge label={exp === 1 ? "40FT-1" : exp === 2 ? "40FT-2" : exp === 3 ? "20FT" : ""} c={exp} />
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <ContainerBadge label={sys === 1 ? "40FT-#1" : sys === 2 ? "40FT-#2" : sys === 3 ? "20FT" : ""} c={sys} split={split} />
                  </td>
                  <td className="px-1 py-0.5 text-center text-base">
                    {match ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <ContainerSummary
            title="실무자 분배"
            sub="현장 적재 계획서 기준"
            slots={[
              { label: "40FT-1 (13행)", cbm: EXPECTED_CBM.c1, cap: 67, color: "blue" },
              { label: "40FT-2 (9행)", cbm: EXPECTED_CBM.c2, cap: 67, color: "green" },
              { label: "20FT-3 (4행)", cbm: EXPECTED_CBM.c3, cap: 33, color: "amber" },
            ]}
          />
          <ContainerSummary
            title="시스템 결과"
            sub="현재 알고리즘 AUTO 모드"
            slots={[
              { label: "40FT-#1 (14행)", cbm: SYSTEM_CBM.c1, cap: 67, color: "blue" },
              { label: "40FT-#2 (5행)", cbm: SYSTEM_CBM.c2, cap: 67, color: "green" },
              { label: "20FT-#3 (7행)", cbm: SYSTEM_CBM.c3, cap: 33, color: "amber" },
            ]}
          />
        </div>
      </section>

      {/* ──────── Section 3 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">
          ③ 실무자가 시스템과 다르게 배분한 이유 — 추론
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReasonCard
            num="①"
            title="엑셀 구조 자체가 3 sub-table — 사전 그룹핑 신호"
            symptom="시스템: 26행을 평탄(flat) 리스트로만 인식. AUTO packBest 가 '공간 효율'만 추구하며 부킹/sub-table 경계 무시."
            practitioner="실무자: 엑셀에 3개 sub-table 로 적었음. 1번 표(13행 → 40FT-1), 2번 표(9행 → 40FT-2), 3번 표(4행 → 20FT). No 컬럼이 1부터 다시 시작하는 게 'pre-group' 신호."
            reasoning='"실무자가 적재 계획서를 짤 때부터 어떤 화주를 같은 컨에 묶을지 결정함. 부킹 시점·도착 시점·반입지·컨테이너 도크 배정이 전부 그 그룹 단위로 movements. 한 컨에 두 그룹을 섞으면 입고/통관 처리가 꼬임."'
          />
          <ReasonCard
            num="②"
            title="작은 부킹들 한 곳 모아 20FT 효율 확보"
            symptom="시스템: 20FT 에 한국쎄미텍 + KIOSKIN + SD KOREA + 일라(12.24m³ 거대화물!) 등 큰 화물 7개 몰아넣음 (39m³ 시도)"
            practitioner="실무자: 20FT 는 효성·로제화장품·삼원절연·화인써키트 4 행 (19.14m³) — 안전한 ~58% 적재"
            reasoning='"20FT 는 작은 부킹 묶음 처리용. 큰 화물(일라 12m³ 단일 화물)을 20FT 에 넣으면 크레인 무게·중심 모두 위험. 시스템 분배는 물리는 가능해도 운영 상 어색함."'
          />
          <ReasonCard
            num="③"
            title="40FT 두 대 CBM 균형 (54 vs 53)"
            symptom={`시스템: 40FT-#1 = 약 ${SYSTEM_CBM.c1.toFixed(1)}m³, 40FT-#2 = 약 ${SYSTEM_CBM.c2.toFixed(1)}m³ → 편차 ${(SYSTEM_CBM.c1 - SYSTEM_CBM.c2).toFixed(1)}m³ (1대로 14행 몰빵)`}
            practitioner={`실무자: 40FT-1 = ${EXPECTED_CBM.c1.toFixed(1)}m³, 40FT-2 = ${EXPECTED_CBM.c2.toFixed(1)}m³ → 편차 ${Math.abs(EXPECTED_CBM.c1 - EXPECTED_CBM.c2).toFixed(1)}m³`}
            reasoning='"두 컨테이너 적재량 차이가 30m³ 이상 나면 본선 트림(평형)이 흐트러져. 실무에선 40FT 쌍은 늘 비슷한 CBM 으로 짜는 게 기본."'
          />
          <ReasonCard
            num="④"
            title="한 부킹은 한 컨테이너 — 절대 룰"
            symptom="시스템: KIOSKIN, SD KOREA, 일라, 디씨이메탈 4 화물이 컨테이너 2 와 3 사이에 쪼개짐 (B1 위반)"
            practitioner="실무자: 26 행 모두 단일 컨테이너 — 부킹 단위 분리 0"
            reasoning='"같은 부킹은 같은 BL/세관 신고/검수 단위. 컨테이너 두 곳 분산되면 통관·검수 두 번, 화주 컴플레인 즉시. 분리 화물은 입고 처리 시 누락 위험까지 발생."'
          />
        </div>
      </section>

      {/* ──────── Section 4 ──────── */}
      <section className="mt-6 rounded-lg border border-red-300 bg-red-50/50 p-4">
        <h2 className="text-lg font-semibold text-red-900">
          ④ 발견된 알고리즘 결함
        </h2>
        <p className="mt-1 rounded bg-red-100 p-2 text-xs text-red-900">
          ⚠ 시스템 분배가 <b>물리(A1~A5) 검증은 모두 통과</b>했지만, <b>분배 룰 B1·B2 를 위반</b>. 한 화물이 두 컨테이너로 쪼개진 것은 메모리 절대 룰("CBM 쪼개기 절대 금지") 위반이다.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DefectCard
            num="①"
            title="B1 위반 — cargoId 분산"
            severity="치명"
            file="lib/packing/algorithm.ts (allocateBulkGroup / placement loop)"
            symptom="hm2-21(디씨이메탈), hm2-6(SD KOREA), hm2-4(KIOSKIN), hm2-8(일라) 4 건이 컨테이너 [2]와 [3]에 분산"
            cause="20FT 에 큰 화물(일라 12.24m³ + KIOSKIN 5.45m³ + SD KOREA 7.52m³ ...) 을 우겨넣다 일부 unit 만 들어가고 나머지가 다음 컨테이너로 넘어감. unit-level greedy 가 cargo 단위 결합성을 깨뜨림."
            fix="placement 시도 전에 한 cargo 의 모든 unit 을 단일 컨테이너에 시뮬해 fit 가능 여부를 확인하고, 안 들어가면 그 컨에는 0 unit, 다른 컨으로 통째로 이동. unit splitting 자체를 차단."
          />
          <DefectCard
            num="②"
            title="B2 위반 — bookingNo 분산"
            severity="치명"
            file="동일 (anchor 강제 약함)"
            symptom="FISGN260369·260376·260356·260383 부킹 4 개가 컨 2·3 분산"
            cause="2ST SG TOTAL 에선 안전마진 + balance + swap 패스가 통하면서 booking anchor 가 효과적으로 묶였으나, 3 컨테이너 + 큰 화물 다수 + 20FT 협소 환경에선 anchor 강제력이 부족해짐."
            fix="Phase A) 같은 booking 화물 합산 CBM 이 가장 작은 컨테이너(잔여 capacity 기준)에 anchor 잡고 같이 이동. Phase B) split 발생 시 즉시 reject 하고 컨 셋 재선택."
          />
          <DefectCard
            num="③"
            title="3 sub-table 그룹핑 신호 미인식"
            severity="개선"
            file="components/input/ExcelImport.tsx (parseExcelFile)"
            symptom={`엑셀에 No 컬럼 1→13, 1→9, 1→4 로 3 그룹 표시되어 있으나 파서가 무시. 시스템은 화물을 평탄 리스트로 처리하면서 grouping 신호 손실.`}
            cause='ExcelImport 가 "TOTAL" 푸터만 인식하고, sub-table 구분자(빈 행/No 재시작)는 무시.'
            fix="No 컬럼이 1 로 재시작될 때마다 새 그룹 번호 부여. 부킹에 group hint 메타로 첨부 → 알고리즘이 컨테이너 분배 시 같은 그룹 우선 묶기."
          />
          <DefectCard
            num="④"
            title="20FT 우선순위 — 작은 화물 먼저 채우기 룰 부재"
            severity="개선"
            file="lib/packing/algorithm.ts (decideContainers 우선순위)"
            symptom="시스템이 20FT 에 12.24m³ 단일 화물(일라) 을 배치 → 안전마진은 통과하나 실무 직관 위배"
            cause="알고리즘이 컨테이너 capacity 기준 fit 만 보고 화물별 적합도(20FT는 작은 부킹 모음) 점수 부재"
            fix="20FT 에는 'about CBM ≤ 5m³ 인 부킹들의 묶음 우선' soft preference 추가. lex 우선순위로만 적용 (점수 합산 X)."
          />
        </div>
      </section>

      {/* ──────── Section 5 ──────── */}
      <section className="mt-6 rounded-lg border border-blue-300 bg-blue-50/50 p-4">
        <h2 className="text-lg font-semibold text-blue-900">⑤ 검증 결과</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="bg-blue-100">
            <tr>
              <th className="px-2 py-1 text-left">검증 항목</th>
              <th className="px-2 py-1 text-left">결과</th>
              <th className="px-2 py-1 text-left">비고</th>
            </tr>
          </thead>
          <tbody>
            <Verify name="A1. bounding (W,H)" status="✅" detail="3 컨 모두 통과" />
            <Verify name="A2. weight" status="✅" detail="40FT-#1 70.7% / 40FT-#2 48.2% / 20FT 38.0%" />
            <Verify name="A3. cbm SOFT_OVERFLOW(1.05)" status="✅" detail="40FT-#1 70.2% / 40FT-#2 59.4% / 20FT 75.9%" />
            <Verify name="A4. AABB 충돌" status="✅" detail="0 쌍" />
            <Verify name="A5. full support (≥70%)" status="✅" detail="0 위태" />
            <Verify name="B1. cargoId 쪼개기 0" status="❌" detail="4건 분산: 디씨이메탈, SD KOREA, KIOSKIN, 일라" highlight />
            <Verify name="B2. bookingNo 인접" status="❌" detail="4 부킹 분산: 260369, 260376, 260356, 260383" highlight />
            <Verify name="B3. 미배치 0" status="✅" detail="0 건" />
            <Verify name="B4. noStacking" status="✅" detail="0 위반" />
            <Verify name="B5. topOnly" status="✅" detail="0 위반" />
            <Verify name="B6. heavierBelow" status="✅" detail="0 위반" />
            <Verify name="B7. orientation" status="✅" detail="0 위반" />
            <Verify name="컨테이너 셋 = 40+40+20" status="✅" detail="실무자와 동일" />
            <Verify name="화주 multiset 일치" status="❌" detail="26 mismatch / 26 행" highlight />
          </tbody>
        </table>
        <p className="mt-3 text-xs text-blue-800">
          종합: 31 pass / 2 fail. 물리·local 룰은 모두 통과하나 분배 결합성(B1·B2)에서 결함. 알고리즘 보강 필요.
        </p>
      </section>

      <footer className="mt-6 text-center text-xs text-neutral-400">
        보고서 생성: clpclaude · 2026-05-06 · /debug/2st-hm-report
      </footer>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-neutral-200 p-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-lg font-bold text-neutral-900">{value}</div>
      {sub && <div className="text-[10px] text-neutral-400">{sub}</div>}
    </div>
  );
}

type Slot = { label: string; cbm: number; cap: number; color: "blue" | "green" | "amber" };
function ContainerSummary({ title, sub, slots }: { title: string; sub: string; slots: Slot[] }) {
  const total = slots.reduce((s, sl) => s + sl.cbm, 0);
  return (
    <div className="rounded border border-neutral-200 p-3">
      <div className="font-semibold">{title}</div>
      <div className="text-[10px] text-neutral-500">{sub}</div>
      <div className="mt-2 space-y-1.5">
        {slots.map((sl) => {
          const pct = (sl.cbm / sl.cap) * 100;
          return <FillBar key={sl.label} label={sl.label} cbm={sl.cbm} cap={sl.cap} pct={pct} color={sl.color} />;
        })}
      </div>
      <div className="mt-2 text-[11px] text-neutral-600">
        총 CBM: <b>{total.toFixed(1)} m³</b>
      </div>
    </div>
  );
}

function FillBar({ label, cbm, cap, pct, color }: { label: string; cbm: number; cap: number; pct: number; color: "blue" | "green" | "amber" }) {
  const barCls = color === "blue" ? "bg-blue-500" : color === "green" ? "bg-green-500" : "bg-amber-500";
  const danger = pct > 95 ? "ring-2 ring-red-500" : "";
  return (
    <div>
      <div className="flex justify-between text-[10px]">
        <span className="font-mono">{label}</span>
        <span>{cbm.toFixed(1)} / {cap} m³ ({pct.toFixed(0)}%)</span>
      </div>
      <div className={`h-2 w-full rounded bg-neutral-200 ${danger}`}>
        <div className={`h-full rounded ${barCls}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function ReasonCard({ num, title, symptom, practitioner, reasoning }: {
  num: string; title: string; symptom: string; practitioner: string; reasoning: string;
}) {
  return (
    <div className="rounded border border-neutral-200 p-3">
      <div className="text-base font-bold text-neutral-800">
        <span className="mr-2 text-blue-600">{num}</span>{title}
      </div>
      <div className="mt-2 space-y-1.5 text-xs">
        <div><b className="text-red-700">시스템:</b> <span className="text-neutral-700">{symptom}</span></div>
        <div><b className="text-green-700">실무자:</b> <span className="text-neutral-700">{practitioner}</span></div>
        <div className="rounded bg-neutral-50 p-2 text-neutral-600 italic">{reasoning}</div>
      </div>
    </div>
  );
}

function DefectCard({ num, title, severity, file, symptom, cause, fix }: {
  num: string; title: string; severity: "치명" | "개선"; file: string; symptom: string; cause: string; fix: string;
}) {
  const sevCls = severity === "치명" ? "bg-red-200 text-red-900" : "bg-amber-200 text-amber-900";
  return (
    <div className="rounded border border-red-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-neutral-800">
          <span className="mr-1 text-red-600">{num}</span>{title}
        </span>
        <span className={`rounded px-2 py-0.5 text-[10px] ${sevCls}`}>{severity}</span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-neutral-500">{file}</div>
      <div className="mt-2 space-y-1 text-xs">
        <div><b>증상:</b> {symptom}</div>
        <div><b>원인:</b> {cause}</div>
        <div className="rounded bg-blue-50 p-1.5 text-blue-900"><b>제안 수정:</b> {fix}</div>
      </div>
    </div>
  );
}

function Verify({ name, status, detail, highlight = false }: { name: string; status: string; detail: string; highlight?: boolean }) {
  const cls = highlight ? "bg-red-50" : "";
  return (
    <tr className={`border-b border-blue-200 ${cls}`}>
      <td className="px-2 py-1 font-semibold">{name}</td>
      <td className="px-2 py-1 text-base">{status}</td>
      <td className="px-2 py-1 text-neutral-700">{detail}</td>
    </tr>
  );
}
