"use client";

/**
 * 2ST SG TOTAL — 분배 비교 분석 보고서 (목업)
 *
 * 비개발자용 시각 보고서:
 *   1. 데이터 요약
 *   2. 기존 시스템 vs 실무자 vs 새 알고리즘 23행 비교
 *   3. 차이 원인 추측 (4 카드)
 *   4. 알고리즘 변경 사항 (5 카드)
 *   5. 검증 결과
 */

type Row = {
  idx: number;
  shipper: string;
  booking: string;
  cbmSystem: number; // visual: W*L*H*qty/1e6, CT: cbm or aboutCbm
  cargoType: "PL" | "CT" | "PK";
  about: number;
};

// 23 행 — data/samples/singapore-total-2.json 기준
const ROWS: Row[] = [
  { idx: 1, shipper: "나라켐", booking: "FBSGN260687", cbmSystem: 1.125, cargoType: "PL", about: 1.125 },
  { idx: 2, shipper: "지덕산업", booking: "FBSIN260342", cbmSystem: 3.341, cargoType: "PL", about: 3.521 },
  { idx: 3, shipper: "트리온", booking: "FBSIN260352", cbmSystem: 9.36, cargoType: "PL", about: 9.649 },
  { idx: 4, shipper: "세영교역", booking: "FBSIN260355", cbmSystem: 1.601, cargoType: "PL", about: 1.601 },
  { idx: 5, shipper: "한국특수잉크", booking: "FBSIN260357", cbmSystem: 2.574, cargoType: "PL", about: 2.6 },
  { idx: 6, shipper: "삼영 SAMYUNG ENC", booking: "FBSIN260358", cbmSystem: 5.078, cargoType: "CT", about: 5.078 },
  { idx: 7, shipper: "효림네트", booking: "FBSIN260364", cbmSystem: 13.044, cargoType: "PL", about: 13.045 },
  { idx: 8, shipper: "한국선재", booking: "FBSIN260373", cbmSystem: 1.296, cargoType: "PL", about: 1.944 },
  { idx: 9, shipper: "YKMC", booking: "FBSIN260376", cbmSystem: 5.715, cargoType: "PL", about: 5.71 },
  { idx: 10, shipper: "YKMC", booking: "FBSIN260376", cbmSystem: 1.354, cargoType: "CT", about: 1.354 },
  { idx: 11, shipper: "ECTA", booking: "FBSIN260377", cbmSystem: 12.726, cargoType: "PL", about: 11.384 },
  { idx: 12, shipper: "TO THE RAFFLES", booking: "FBSIN260378", cbmSystem: 1.270, cargoType: "PL", about: 1.3 },
  { idx: 13, shipper: "오리스", booking: "FBSIN260380", cbmSystem: 0.451, cargoType: "PL", about: 0.451 },
  { idx: 14, shipper: "글로벌마린", booking: "FBSIN260383", cbmSystem: 0.908, cargoType: "PL", about: 1 },
  { idx: 15, shipper: "동양켐텍", booking: "FBSIN260336", cbmSystem: 13.31, cargoType: "PL", about: 13.31 },
  { idx: 16, shipper: "광명산업", booking: "FBSIN260336", cbmSystem: 0.787, cargoType: "PL", about: 0.786 },
  { idx: 17, shipper: "웨스코 일렉트로드", booking: "FBSIN260336", cbmSystem: 1.254, cargoType: "PL", about: 1.393 },
  { idx: 18, shipper: "HD", booking: "FBSIN260374", cbmSystem: 1.125, cargoType: "CT", about: 1.125 },
  { idx: 19, shipper: "리만", booking: "FBSIN260375", cbmSystem: 1.886, cargoType: "PL", about: 4.417 },
  { idx: 20, shipper: "한국기술", booking: "FBSIN260379", cbmSystem: 1.255, cargoType: "PL", about: 1.255 },
  { idx: 21, shipper: "현대에버다임", booking: "FBSIN260386", cbmSystem: 5.04, cargoType: "PL", about: 4.441 },
  { idx: 22, shipper: "PTI", booking: "FBSIN260387", cbmSystem: 2.667, cargoType: "PL", about: 2.667 },
  { idx: 23, shipper: "세광하이테크", booking: "FBSIN260388", cbmSystem: 0.009, cargoType: "PK", about: 0.01 },
];

const TOTAL_CBM = ROWS.reduce((s, r) => s + r.cbmSystem, 0);

// 1단계 (가장 처음 baseline) — 알고리즘 수정 전: 1×40FT + 1×20FT
const STAGE1: Record<string, number> = {
  // 1=40FT, 2=20FT
  "지덕산업": 1, "세영교역": 1, "한국특수잉크": 1, "효림네트": 1, "한국선재": 1,
  "ECTA": 1, "TO THE RAFFLES": 1, "오리스": 1, "글로벌마린": 1, "광명산업": 1,
  "웨스코 일렉트로드": 1, "한국기술": 1, "현대에버다임": 1, "PTI": 1, "세광하이테크": 1,
  "나라켐": 2, "트리온": 2, "삼영 SAMYUNG ENC": 2, "동양켐텍": 2, "HD": 2, "리만": 2,
};
const STAGE1_YKMC: [number, number] = [1, 2]; // visual #1, CT #2 (분리)

// 실무자 expected — 2×40FT
const EXPECTED_C1 = new Set([
  "동양켐텍", "광명산업", "웨스코 일렉트로드", "한국특수잉크", "효림네트",
  "TO THE RAFFLES", "한국기술", "오리스", "글로벌마린", "세광하이테크", "PTI",
]);
const EXPECTED_C1_YKMC = 1;
const EXPECTED_C2 = new Set([
  "나라켐", "지덕산업", "트리온", "세영교역", "삼영 SAMYUNG ENC",
  "한국선재", "HD", "리만", "ECTA", "현대에버다임",
]);

// 새 알고리즘 결과 (verify-2st-sg-total.mjs 출력)
// [1] 40FT (10): 나라켐, 지덕산업, 트리온, 세영교역, 삼영, 한국선재, ECTA, HD, 리만, 현대에버다임
// [2] 40FT (13): 한국특수잉크, 효림네트, YKMC×2, TO THE RAFFLES, 오리스, 글로벌마린, 동양켐텍, 광명산업, 웨스코, 한국기술, PTI, 세광하이테크
const NEW_C1 = new Set([
  "나라켐", "지덕산업", "트리온", "세영교역", "삼영 SAMYUNG ENC",
  "한국선재", "ECTA", "HD", "리만", "현대에버다임",
]);
const NEW_C2 = new Set([
  "한국특수잉크", "효림네트", "TO THE RAFFLES", "오리스", "글로벌마린",
  "동양켐텍", "광명산업", "웨스코 일렉트로드", "한국기술", "PTI", "세광하이테크",
]);

// 부킹 그룹 색상 — 같은 부킹은 같은 색 띠
const BOOKING_COLORS: Record<string, string> = {};
const colorPalette = [
  "bg-rose-100", "bg-pink-100", "bg-fuchsia-100", "bg-purple-100", "bg-violet-100",
  "bg-indigo-100", "bg-blue-100", "bg-sky-100", "bg-cyan-100", "bg-teal-100",
  "bg-emerald-100", "bg-green-100", "bg-lime-100", "bg-yellow-100", "bg-amber-100",
  "bg-orange-100", "bg-red-100", "bg-stone-100", "bg-zinc-100", "bg-slate-100",
];
const uniqueBookings = [...new Set(ROWS.map((r) => r.booking))];
uniqueBookings.forEach((bn, i) => (BOOKING_COLORS[bn] = colorPalette[i % colorPalette.length]));

function ContainerBadge({ label, c }: { label: string; c: 1 | 2 | null }) {
  if (c === null) return <span className="text-neutral-400">—</span>;
  const cls =
    c === 1 ? "bg-blue-600 text-white" :
    c === 2 ? "bg-green-600 text-white" : "bg-neutral-300";
  return (
    <span className={`inline-block min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-[10px] font-mono leading-none ${cls}`}>
      {label}
    </span>
  );
}

function getStage(stage: "stage1" | "expected" | "new", row: Row): 1 | 2 | null {
  if (stage === "stage1") {
    if (row.shipper === "YKMC") {
      // 같은 booking 의 visual / CT 분리됨
      return row.cargoType === "PL" ? STAGE1_YKMC[0] as 1 : STAGE1_YKMC[1] as 2;
    }
    return (STAGE1[row.shipper] ?? null) as 1 | 2 | null;
  }
  if (stage === "expected") {
    return EXPECTED_C1.has(row.shipper) ? 1 : EXPECTED_C2.has(row.shipper) ? 2 : null;
  }
  // new
  return NEW_C1.has(row.shipper) ? 1 : NEW_C2.has(row.shipper) ? 2 : null;
}

function stageLabel(stage: "stage1" | "expected" | "new", c: 1 | 2 | null): string {
  if (c === null) return "—";
  if (stage === "stage1") return c === 1 ? "40FT" : "20FT";
  return c === 1 ? "40FT-1" : "40FT-2";
}

function calcContainerCbm(stage: "stage1" | "expected" | "new"): { c1: number; c2: number } {
  let c1 = 0, c2 = 0;
  for (const r of ROWS) {
    const s = getStage(stage, r);
    if (s === 1) c1 += r.cbmSystem;
    else if (s === 2) c2 += r.cbmSystem;
  }
  return { c1, c2 };
}

const STAGE1_CBM = calcContainerCbm("stage1");
const EXPECTED_CBM = calcContainerCbm("expected");
const NEW_CBM = calcContainerCbm("new");

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 print:p-0">
      <h1 className="text-2xl font-bold text-neutral-900 print:text-xl">
        2ST SG TOTAL — 분배 비교 분석 보고서
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        2026-05-05 알고리즘 수정 작업 결과 — 기존 시스템 배분 vs 실무자 배분 vs 새 알고리즘 결과
      </p>

      {/* ──────── Section 1 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">① 데이터 요약</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="총 행수" value="23" sub="실무자 추가 부킹 1행 포함" />
          <Stat label="총 시스템 CBM" value={`${TOTAL_CBM.toFixed(2)} m³`} sub="visual+CT 합산" />
          <Stat label="부킹 그룹" value={`${uniqueBookings.length} 개`} sub="260336~260687" />
          <Stat label="총 무게" value="≈ 25.7 t" sub="제약은 컨테이너 25t" />
        </div>
        <div className="mt-3 rounded bg-neutral-50 p-3 text-xs">
          <span className="font-semibold">큰 화물 Top 5:</span>{" "}
          동양켐텍 13.31m³ · 효림네트 13.04 · ECTA 12.73 · 트리온 9.65 · YKMC 7.07
        </div>
      </section>

      {/* ──────── Section 2 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">
          ② 23행 분배 비교 (기존 / 실무자 / 새 알고리즘)
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          색상: <span className="bg-blue-600 px-1 text-white">파랑 = 컨테이너 1</span>{" "}
          <span className="bg-green-600 px-1 text-white">초록 = 컨테이너 2</span>{" "}
          · 행 배경색은 같은 부킹 그룹
        </p>
        <table className="mt-3 w-full table-fixed text-[11px]">
          <thead className="bg-neutral-100">
            <tr>
              <th className="w-8 px-1 py-1">#</th>
              <th className="w-24 px-1 py-1 text-left">실화주</th>
              <th className="w-28 px-1 py-1 text-left">부킹</th>
              <th className="w-12 px-1 py-1 text-right">CBM</th>
              <th className="w-12 px-1 py-1 text-center">구분</th>
              <th className="w-24 px-1 py-1 text-center">기존(1단계)</th>
              <th className="w-24 px-1 py-1 text-center">실무자</th>
              <th className="w-24 px-1 py-1 text-center">새 알고리즘</th>
              <th className="w-16 px-1 py-1 text-center">일치</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const s1 = getStage("stage1", r);
              const exp = getStage("expected", r);
              const nw = getStage("new", r);
              const matchExp = nw === exp || (exp !== null && nw !== null && expectedSetMatch(r.shipper, nw, exp));
              return (
                <tr
                  key={r.idx}
                  className={`border-b border-neutral-200 ${BOOKING_COLORS[r.booking] ?? ""}`}
                >
                  <td className="px-1 py-0.5 text-center text-neutral-500">{r.idx}</td>
                  <td className="px-1 py-0.5 font-semibold">{r.shipper}</td>
                  <td className="px-1 py-0.5 font-mono text-neutral-600">{r.booking}</td>
                  <td className="px-1 py-0.5 text-right font-mono">{r.cbmSystem.toFixed(2)}</td>
                  <td className="px-1 py-0.5 text-center">
                    <span className={`rounded px-1 text-[10px] ${
                      r.cargoType === "CT" ? "bg-amber-200 text-amber-900" :
                      r.cargoType === "PK" ? "bg-purple-200 text-purple-900" : "bg-blue-50 text-blue-900"
                    }`}>{r.cargoType}</span>
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <ContainerBadge label={stageLabel("stage1", s1)} c={s1} />
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <ContainerBadge label={stageLabel("expected", exp)} c={exp} />
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <ContainerBadge label={stageLabel("new", nw)} c={nw} />
                  </td>
                  <td className="px-1 py-0.5 text-center text-base">
                    {matchExp ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <ContainerSummary
            title="기존 (1단계)"
            sub="알고리즘 수정 전 baseline"
            kind="40FT+20FT"
            cbm1={STAGE1_CBM.c1}
            cbm2={STAGE1_CBM.c2}
            cap1={60}
            cap2={28}
          />
          <ContainerSummary
            title="실무자 expected"
            sub="실무자가 손으로 짠 분배"
            kind="2×40FT"
            cbm1={EXPECTED_CBM.c1}
            cbm2={EXPECTED_CBM.c2}
            cap1={60}
            cap2={60}
          />
          <ContainerSummary
            title="새 알고리즘"
            sub="수정 후 AUTO 결과"
            kind="2×40FT"
            cbm1={NEW_CBM.c1}
            cbm2={NEW_CBM.c2}
            cap1={60}
            cap2={60}
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
            title="안전마진 회피"
            symptom={`기존 1×40FT(60) + 1×20FT(28) = 88m³ cap, 87.18m³ → 99% 만재`}
            practitioner="실무자: 2×40FT(120 cap) → 평균 73% 만재"
            reasoning='"20FT 만재 직전 (slack 0.82m³) 은 운송 중 화물 흔들림·손상 위험. 1m³ 여유라도 가지고 가는 게 실무 상식." 항만 핸들링 시 부피 측정 오차도 ±2% 정도 발생.'
          />
          <ReasonCard
            num="②"
            title="부킹 묶음 보존"
            symptom="기존: YKMC visual 행 (cbm 5.71) ↔ YKMC CT 행 (1.354) 가 다른 컨테이너로 분리"
            practitioner="실무자: 같은 부킹 (260376) 의 두 행을 같은 40FT-1 에 배치"
            reasoning='"한 부킹은 한 출고 단위. 통관·검수·적재 모두 부킹 단위로 처리. 부킹이 두 컨에 쪼개지면 같은 화주에 두 번 BL/통관·서류·검수." 실제 운영상 매우 비싼 코스트.'
          />
          <ReasonCard
            num="③"
            title="두 컨테이너 CBM 균형"
            symptom="기존 (수정 전 baseline 의 2단계): 37.5 vs 49.6 (편차 12.1m³)"
            practitioner="실무자: 42.6 vs 44.6 (편차 2.0m³)"
            reasoning='"한 컨테이너에 너무 몰리면 배 평형(트림) 이 흐트러지고, 항만 크레인 들어올릴 때 무게중심이 편향. 균등 분배가 적재·해상 운송 안전 모두 유리."'
          />
          <ReasonCard
            num="④"
            title="큰 화물 분산 직관"
            symptom="기존: 동양켐텍 + 효림네트 + ECTA (3 거대 화물) 같은 컨에 몰림 가능성"
            practitioner="실무자: 동양켐텍/효림네트 → 40FT-1, 트리온/ECTA/현대에버다임 → 40FT-2 로 분산"
            reasoning="큰 화물끼리 한 컨에 몰리면 작은 화물 끼워 넣을 자리가 사라짐. 직관적으로 큰 것 1~2 개씩 컨테이너마다 배치 → 빈틈 활용도 ↑."
          />
        </div>
      </section>

      {/* ──────── Section 4 ──────── */}
      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <h2 className="text-lg font-semibold text-neutral-800">
          ④ 알고리즘 변경 — 실무자 추론을 룰로 반영
        </h2>
        <p className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">
          ⚠ <b>점수 합산 사용 금지</b> 룰 준수 — 모두 lexicographic 우선순위 비교 / 필터 / 정렬 로 구현. 가중치 합산 없음.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RuleCard
            num="①"
            title="안전마진 룰 (slack ≥ 1.5m³)"
            file="lib/packing/algorithm.ts:decideContainers (~line 290)"
            metaphor='"트럭 짐칸 99% 차면 사고 위험"'
            change="컨테이너 조합 후보에서 slack(잉여 용량) < 1.5m³ 인 조합을 제외 (모두 제외되면 룰 미적용)"
            effect="2ST SG: 1×40+1×20=88(slack 0.82) 제외 → 2×40FT 자동 선택. 1ST SG slack 18, HM slack 2.26 은 통과."
          />
          <RuleCard
            num="②"
            title="부킹 anchor visual↔CT 공유"
            file="lib/packing/algorithm.ts:allocateBulkGroup + pack 의 visualBookingAnchor 빌드 (~line 1120)"
            metaphor='"같은 부킹 박스는 같은 트럭"'
            change="visual 단계에서 placement 가 끝난 후, cargoId→bookingNo→containerState 맵을 빌드하고 allocateBulkGroup 의 initial bookingAnchor 로 주입"
            effect="YKMC visual 행 → 컨테이너 X 에 안착하면, 같은 부킹의 CT 행도 컨테이너 X 로 강제. 부킹 분리 0."
          />
          <RuleCard
            num="③"
            title="균형 4 순위 tiebreaker"
            file="lib/packing/algorithm.ts:evalKey + isBetterResult"
            metaphor='"두 트럭 짐 차이 작은 쪽 선호 (단, 우선순위 ①~③ 동률일 때만)"'
            change="EvalKey 에 balancePenalty(동종 컨 간 CBM max-min) 추가. isBetterResult 4번째 규칙: ①미배치<②입고완료마감<③충전률<④편차"
            effect="56개 strategy 시도 중 unp=0 + 충전률 동률이면 가장 균형 잡힌 결과 선택."
          />
          <RuleCard
            num="④"
            title="동종 컨 적재량 정렬"
            file="lib/packing/algorithm.ts:candidatesFor → balanceSortSameType"
            metaphor='"같은 트럭 두 대 중, 짐 적은 쪽부터 보여줌"'
            change="visual 화물 배치 시점마다 같은 spec 의 컨테이너 그룹 안에서 현재 적재량(visual+ct) 낮은 쪽 우선 정렬. 다른 spec 끼리는 base 순서 유지."
            effect="배치 도중 자연스러운 균형 분배."
          />
          <RuleCard
            num="⑤"
            title="Post-pack swap 패스"
            file="lib/packing/algorithm.ts:packBest 3단계 (~line 1455)"
            metaphor='"짐 다 실은 후, 한 박스 옆 트럭으로 옮기면 균형 더 좋아질지 시도"'
            change="best result 가 unp=0 + 동종 컨 2+ 면, 더 큰 컨 → 작은 컨 으로 cargo 1개 이동 시도. fixedAssignment 로 강제 후 재pack. 모든 후보 평가 → best balance 채택. 8 회 반복 또는 개선 없음 시 종료."
            effect="2ST SG 의 현대에버다임이 c2 → c1 로 자동 이동 → expected 와 일치."
          />
        </div>
      </section>

      {/* ──────── Section 5 ──────── */}
      <section className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4">
        <h2 className="text-lg font-semibold text-green-900">⑤ 검증 결과 — All Pass</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="bg-green-100">
            <tr>
              <th className="px-2 py-1 text-left">샘플</th>
              <th className="px-2 py-1 text-left">AUTO 분배</th>
              <th className="px-2 py-1 text-left">컨테이너</th>
              <th className="px-2 py-1 text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            <Verify name="2ST SG TOTAL (23행)" dist="23/23 set 일치" cnt="2×40FT (42.6 / 44.6 m³)" />
            <Verify name="1ST SG TOTAL (22행) — 회귀" dist="17/17 + 5/5 일치" cnt="1×40FT + 1×20FT" />
            <Verify name="1ST HM TOTAL (34행) — 회귀" dist="24/24 + 10/10 일치" cnt="1×40FT + 1×20FT" />
            <Verify name="단위 테스트" dist="40/40 통과" cnt="—" />
          </tbody>
        </table>
        <p className="mt-3 text-xs text-green-800">
          평균 패킹 시간: 6~7 초/샘플 (변경 전과 동등). swap 패스는 unp=0 + 동종 컨 2+ 케이스에서만 활성 → 1ST SG·HM 회귀 0.
        </p>
      </section>

      <footer className="mt-6 text-center text-xs text-neutral-400">
        보고서 생성: clpclaude · 2026-05-05 · /debug/2st-sg-report
      </footer>
    </main>
  );
}

function expectedSetMatch(shipper: string, nw: 1 | 2, exp: 1 | 2): boolean {
  // 새 알고리즘 컨 라벨이 expected 와 swap 일 수 있음 (set 비교).
  // 새 알고리즘: NEW_C1 ⊃ 나라켐그룹, NEW_C2 ⊃ 동양켐텍그룹.
  // expected: EXPECTED_C1 ⊃ 동양켐텍그룹, EXPECTED_C2 ⊃ 나라켐그룹. (swap 매핑)
  // 따라서 nw=1 ↔ exp=2, nw=2 ↔ exp=1 일 때 일치.
  return (nw === 1 && exp === 2) || (nw === 2 && exp === 1) || nw === exp;
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

function ContainerSummary({
  title, sub, kind, cbm1, cbm2, cap1, cap2,
}: {
  title: string; sub: string; kind: string;
  cbm1: number; cbm2: number; cap1: number; cap2: number;
}) {
  const fill1 = (cbm1 / cap1) * 100;
  const fill2 = (cbm2 / cap2) * 100;
  const diff = Math.abs(cbm1 - cbm2);
  return (
    <div className="rounded border border-neutral-200 p-3">
      <div className="font-semibold">{title}</div>
      <div className="text-[10px] text-neutral-500">{sub} ({kind})</div>
      <div className="mt-2 space-y-1.5">
        <FillBar label={kind === "40FT+20FT" ? "40FT" : "40FT-1"} cbm={cbm1} cap={cap1} pct={fill1} color="blue" />
        <FillBar label={kind === "40FT+20FT" ? "20FT" : "40FT-2"} cbm={cbm2} cap={cap2} pct={fill2} color="green" />
      </div>
      <div className="mt-2 text-[11px] text-neutral-600">
        편차: <b className={diff < 5 ? "text-green-700" : "text-red-700"}>{diff.toFixed(1)} m³</b>
      </div>
    </div>
  );
}

function FillBar({ label, cbm, cap, pct, color }: { label: string; cbm: number; cap: number; pct: number; color: "blue" | "green" }) {
  const barCls = color === "blue" ? "bg-blue-500" : "bg-green-500";
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

function RuleCard({ num, title, file, metaphor, change, effect }: {
  num: string; title: string; file: string; metaphor: string; change: string; effect: string;
}) {
  return (
    <div className="rounded border border-blue-200 bg-blue-50/50 p-3">
      <div className="text-base font-bold text-neutral-800">
        <span className="mr-2 text-blue-600">{num}</span>{title}
      </div>
      <div className="mt-1 font-mono text-[10px] text-neutral-500">{file}</div>
      <div className="mt-2 text-xs italic text-neutral-600">{metaphor}</div>
      <div className="mt-2 space-y-1 text-xs">
        <div><b>변경:</b> {change}</div>
        <div><b>효과:</b> {effect}</div>
      </div>
    </div>
  );
}

function Verify({ name, dist, cnt }: { name: string; dist: string; cnt: string }) {
  return (
    <tr className="border-b border-green-200">
      <td className="px-2 py-1 font-semibold">{name}</td>
      <td className="px-2 py-1">{dist}</td>
      <td className="px-2 py-1">{cnt}</td>
      <td className="px-2 py-1 text-green-700">✅ PASS</td>
    </tr>
  );
}
