"use client";

/**
 * 2ST HM TOTAL — 실무자 vs 시스템 분배 좌우 비교 (목업)
 *
 * 좌: 실무자 분배 (현장 적재 계획서)
 * 우: 시스템 분배 (verify-2st-hm-total.mjs / 2026-05-06)
 *
 * 컨테이너 카드 (3개씩):
 *   - 종류 / 화주수 / 박스수 / 총 CBM (시각+입고완료 분리)
 *   - CFS CBM (입고완료 = cbm 필드 있음, 시각 = cbm null + aboutCbm)
 *   - 무게 / 부피·무게 적재율
 *   - 화주 목록 표 (입고완료 행 노란 배경)
 */

import sample from "../../../data/samples/hochiminh-total-2.json";

// ───────────────────────────── 타입 ─────────────────────────────

type SampleRow = {
  cargoType: string;
  bookingNo: string;
  houseBlNo: string;
  actualShipperName: string;
  shipperName: string;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  quantity: number;
  weightPerUnitKg: number;
  cbm: number | null;
  aboutCbm: number;
  noStacking: boolean;
  topOnly: boolean;
  orientation: string;
  heavierBelow: boolean;
  itemRemark: string;
  unitSizes?: { width: number; length: number; height: number; quantity: number; weight: number }[];
};

const ROWS = (sample as { rows: SampleRow[] }).rows;

// ───────────────────────────── 분배 정의 ─────────────────────────────

// 실무자 (사용자 확정)
const PRACTITIONER: Record<number, string[]> = {
  1: [
    "AMS", "한국쎄미텍", "유라", "KIOSKIN", "전영사",
    "SD KOREA", "SJIT", "일라", "SJI", "KFTS",
    "한성엔터프라이즈", "이구산업", "케이티엔테크놀러지",
  ],
  2: [
    "제임스텍", "중앙바이오텍", "리브유", "파인 파인비나", "블루오션",
    "파인비나", "장안어패럴", "디씨이메탈", "스톰테크",
  ],
  3: [
    "효성", "로제화장품", "삼원절연", "화인써키트",
  ],
};

// 시스템 (verify-2st-hm-total.mjs 출력 — 2026-05-06)
const SYSTEM: Record<number, string[]> = {
  1: [
    "AMS", "유라", "전영사", "한성엔터프라이즈", "이구산업",
    "제임스텍", "중앙바이오텍", "파인 파인비나", "파인비나", "장안어패럴",
    "효성", "로제화장품", "삼원절연", "화인써키트",
  ],
  2: [
    "한국쎄미텍", "SD KOREA", "일라", "KFTS",
    "케이티엔테크놀러지", "리브유", "블루오션",
    "디씨이메탈", "스톰테크",
  ],
  3: [
    "KIOSKIN", "SJIT", "SJI",
  ],
};

// 컨테이너 종류 (실무자/시스템 동일: 1=40FT, 2=40FT, 3=20FT)
const CONTAINER_TYPE: Record<number, "40FT" | "20FT"> = { 1: "40FT", 2: "40FT", 3: "20FT" };

// 적재 한도 (메모리: 40FT 75.25 m³ / 25,000kg, 20FT 32.86 m³ / 21,000kg)
const CAP_CBM: Record<"40FT" | "20FT", number> = { "40FT": 75.25, "20FT": 32.86 };
const CAP_WEIGHT: Record<"40FT" | "20FT", number> = { "40FT": 25000, "20FT": 21000 };

// ───────────────────────────── 계산 헬퍼 ─────────────────────────────

function findRow(shipper: string): SampleRow | undefined {
  return ROWS.find((r) => r.actualShipperName === shipper);
}

/** CFS 입고완료 여부 — cbm 필드가 null 이 아니고 숫자면 입고완료 (실 측정값 반영) */
function isWarehouseDone(r: SampleRow): boolean {
  return r.cbm !== null && r.cbm !== undefined;
}

/** 행 총중량 (kg) */
// weightPerUnitKg 컬럼명은 misleading — 실제 row 총중량
function rowWeight(r: SampleRow): number {
  return r.weightPerUnitKg;
}

/** 행 단위 CBM — 입고완료면 cbm, 아니면 aboutCbm */
function rowCbm(r: SampleRow): number {
  return isWarehouseDone(r) ? (r.cbm ?? 0) : r.aboutCbm;
}

type ContainerStat = {
  shippers: SampleRow[];
  shipperCount: number;
  boxCount: number;
  totalCbm: number;
  warehouseCbm: number;   // 입고완료 분
  visualCbm: number;      // 시각 (aboutCbm) 분
  totalWeight: number;
};

function statsFor(shippers: string[]): ContainerStat {
  const rows = shippers.map(findRow).filter(Boolean) as SampleRow[];
  let warehouseCbm = 0;
  let visualCbm = 0;
  let weight = 0;
  let boxes = 0;
  for (const r of rows) {
    if (isWarehouseDone(r)) warehouseCbm += r.cbm ?? 0;
    else visualCbm += r.aboutCbm;
    weight += rowWeight(r);
    boxes += r.quantity;
  }
  return {
    shippers: rows,
    shipperCount: rows.length,
    boxCount: boxes,
    totalCbm: warehouseCbm + visualCbm,
    warehouseCbm,
    visualCbm,
    totalWeight: weight,
  };
}

// ───────────────────────────── 페이지 ─────────────────────────────

export default function Page() {
  const practStats = [1, 2, 3].map((c) => statsFor(PRACTITIONER[c]));
  const sysStats = [1, 2, 3].map((c) => statsFor(SYSTEM[c]));

  const practTotalWeight = practStats.reduce((s, x) => s + x.totalWeight, 0);
  const sysTotalWeight = sysStats.reduce((s, x) => s + x.totalWeight, 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] p-3 sm:p-5">
      <header>
        <h1 className="text-2xl font-bold text-neutral-900">
          2ST HM TOTAL — 실무자 vs 시스템 분배 비교
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          좌: 실무자 적재 계획서 · 우: 시스템 알고리즘 결과 (verify-2st-hm-total.mjs · 2026-05-06)
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <Legend dot="bg-yellow-200" label="입고완료 (cbm 측정값)" />
          <Legend dot="bg-white border border-neutral-300" label="시각 (aboutCbm 추정)" />
          <Legend dot="bg-blue-500" label="40FT (75.25 m³ / 25t)" />
          <Legend dot="bg-amber-500" label="20FT (32.86 m³ / 21t)" />
        </div>
      </header>

      {/* 좌우 split */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ───── 좌: 실무자 ───── */}
        <div className="rounded-xl border-2 border-green-300 bg-green-50/30 p-3">
          <SideHeader title="실무자 분배" sub="현장 적재 계획서 기준" tone="green" />
          {[1, 2, 3].map((c, i) => (
            <ContainerCard
              key={`p-${c}`}
              slot={c}
              type={CONTAINER_TYPE[c]}
              stat={practStats[i]}
              tone="green"
            />
          ))}
          <SideTotal total={practTotalWeight} containers={practStats} />
        </div>

        {/* ───── 우: 시스템 ───── */}
        <div className="rounded-xl border-2 border-red-300 bg-red-50/30 p-3">
          <SideHeader title="시스템 분배" sub="현재 알고리즘 AUTO 모드" tone="red" />
          {[1, 2, 3].map((c, i) => (
            <ContainerCard
              key={`s-${c}`}
              slot={c}
              type={CONTAINER_TYPE[c]}
              stat={sysStats[i]}
              tone="red"
            />
          ))}
          <SideTotal total={sysTotalWeight} containers={sysStats} />
        </div>
      </section>

      {/* 하단 요약 — 무게 배분 / CFS 분포 */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-semibold">컨테이너별 비교 요약</h2>

        <h3 className="mt-3 text-sm font-semibold text-neutral-700">무게 배분 비율</h3>
        <table className="mt-2 w-full text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="w-16 px-2 py-1 text-left">컨</th>
              <th className="w-14 px-2 py-1 text-left">종류</th>
              <th className="px-2 py-1 text-left">실무자</th>
              <th className="px-2 py-1 text-left">시스템</th>
              <th className="w-24 px-2 py-1 text-right">차이 (kg)</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((c, i) => {
              const p = practStats[i];
              const s = sysStats[i];
              const diff = s.totalWeight - p.totalWeight;
              return (
                <tr key={`w-${c}`} className="border-b border-neutral-200">
                  <td className="px-2 py-1 font-bold">컨{c}</td>
                  <td className="px-2 py-1">{CONTAINER_TYPE[c]}</td>
                  <td className="px-2 py-1">
                    <WeightBar
                      kg={p.totalWeight}
                      pct={(p.totalWeight / practTotalWeight) * 100}
                      cap={CAP_WEIGHT[CONTAINER_TYPE[c]]}
                      tone="green"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <WeightBar
                      kg={s.totalWeight}
                      pct={(s.totalWeight / sysTotalWeight) * 100}
                      cap={CAP_WEIGHT[CONTAINER_TYPE[c]]}
                      tone="red"
                    />
                  </td>
                  <td className={`px-2 py-1 text-right font-mono ${diff > 0 ? "text-red-600" : diff < 0 ? "text-blue-600" : "text-neutral-500"}`}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3 className="mt-5 text-sm font-semibold text-neutral-700">CFS CBM 분포 (입고완료 vs 시각)</h3>
        <table className="mt-2 w-full text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="w-16 px-2 py-1 text-left">컨</th>
              <th className="px-2 py-1 text-right">실무자 입고완료</th>
              <th className="px-2 py-1 text-right">실무자 시각</th>
              <th className="px-2 py-1 text-right">시스템 입고완료</th>
              <th className="px-2 py-1 text-right">시스템 시각</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((c, i) => (
              <tr key={`cfs-${c}`} className="border-b border-neutral-200">
                <td className="px-2 py-1 font-bold">컨{c}</td>
                <td className="px-2 py-1 text-right font-mono bg-yellow-50">
                  {practStats[i].warehouseCbm.toFixed(2)} m³
                </td>
                <td className="px-2 py-1 text-right font-mono">
                  {practStats[i].visualCbm.toFixed(2)} m³
                </td>
                <td className="px-2 py-1 text-right font-mono bg-yellow-50">
                  {sysStats[i].warehouseCbm.toFixed(2)} m³
                </td>
                <td className="px-2 py-1 text-right font-mono">
                  {sysStats[i].visualCbm.toFixed(2)} m³
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-neutral-500">
          노란 칸 = CFS 입고완료(cbm 필드) · 흰 칸 = 시각(aboutCbm) — 어느 컨에 측정값이 몰려있는지 한눈에 비교.
        </p>
      </section>

      <footer className="mt-6 text-center text-xs text-neutral-400">
        보고서 생성: clpclaude · 2026-05-08 · /debug/2st-hm-compare
      </footer>
    </main>
  );
}

// ───────────────────────────── 보조 컴포넌트 ─────────────────────────────

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5">
      <span className={`inline-block h-3 w-3 rounded ${dot}`} />
      {label}
    </span>
  );
}

function SideHeader({ title, sub, tone }: { title: string; sub: string; tone: "green" | "red" }) {
  const cls = tone === "green" ? "text-green-900" : "text-red-900";
  return (
    <div className="mb-2">
      <h2 className={`text-lg font-bold ${cls}`}>{title}</h2>
      <p className="text-[11px] text-neutral-500">{sub}</p>
    </div>
  );
}

function SideTotal({ total, containers }: { total: number; containers: ContainerStat[] }) {
  const cbm = containers.reduce((s, c) => s + c.totalCbm, 0);
  const boxes = containers.reduce((s, c) => s + c.boxCount, 0);
  return (
    <div className="mt-2 rounded bg-neutral-100 p-2 text-[11px] text-neutral-700">
      합계: 박스 <b>{boxes}</b> · CBM <b>{cbm.toFixed(2)} m³</b> · 무게 <b>{(total / 1000).toFixed(2)} t</b>
    </div>
  );
}

function ContainerCard({
  slot,
  type,
  stat,
  tone,
}: {
  slot: number;
  type: "40FT" | "20FT";
  stat: ContainerStat;
  tone: "green" | "red";
}) {
  const cbmCap = CAP_CBM[type];
  const wCap = CAP_WEIGHT[type];
  const cbmPct = (stat.totalCbm / cbmCap) * 100;
  const wPct = (stat.totalWeight / wCap) * 100;
  const containerCls = type === "40FT" ? "bg-blue-500" : "bg-amber-500";

  return (
    <div className="mb-3 rounded-lg border border-neutral-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold text-white ${containerCls}`}>
            컨{slot} · {type}
          </span>
          <span className="text-xs text-neutral-600">
            화주 <b>{stat.shipperCount}</b> · 박스 <b>{stat.boxCount}</b>
          </span>
        </div>
        <div className="text-[11px] text-neutral-500">
          무게 <b>{(stat.totalWeight / 1000).toFixed(2)} t</b>
        </div>
      </div>

      {/* CBM 합계 (입고완료 + 시각 분리 표시) */}
      <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px]">
        <div className="rounded bg-neutral-50 px-1.5 py-1">
          <div className="text-neutral-500">총 CBM</div>
          <div className="font-mono text-sm font-bold">{stat.totalCbm.toFixed(2)}</div>
        </div>
        <div className="rounded bg-yellow-100 px-1.5 py-1">
          <div className="text-yellow-800">입고완료</div>
          <div className="font-mono text-sm font-bold">{stat.warehouseCbm.toFixed(2)}</div>
        </div>
        <div className="rounded bg-white border border-neutral-200 px-1.5 py-1">
          <div className="text-neutral-500">시각</div>
          <div className="font-mono text-sm font-bold">{stat.visualCbm.toFixed(2)}</div>
        </div>
      </div>

      {/* 적재율 막대 */}
      <div className="mt-2 space-y-1">
        <Bar
          label="부피"
          value={`${stat.totalCbm.toFixed(1)} / ${cbmCap.toFixed(1)} m³`}
          pct={cbmPct}
          tone={tone}
        />
        <Bar
          label="무게"
          value={`${(stat.totalWeight / 1000).toFixed(1)} / ${(wCap / 1000).toFixed(1)} t`}
          pct={wPct}
          tone={tone}
        />
      </div>

      {/* 화주 목록 */}
      <table className="mt-2 w-full text-[10px]">
        <thead className="bg-neutral-100 text-neutral-600">
          <tr>
            <th className="px-1 py-0.5 text-left">화주</th>
            <th className="px-1 py-0.5 text-center w-9">구분</th>
            <th className="px-1 py-0.5 text-left w-24">사이즈 W×L×H</th>
            <th className="px-1 py-0.5 text-right w-8">수량</th>
            <th className="px-1 py-0.5 text-right w-14">행 총중량 (kg)</th>
            <th className="px-1 py-0.5 text-right w-12">CBM</th>
          </tr>
        </thead>
        <tbody>
          {stat.shippers.map((r) => {
            const done = isWarehouseDone(r);
            const sizeStr =
              r.widthCm && r.lengthCm && r.heightCm
                ? `${r.widthCm}×${r.lengthCm}×${r.heightCm}`
                : "—";
            return (
              <tr
                key={r.actualShipperName}
                className={`border-b border-neutral-100 ${done ? "bg-yellow-50" : ""}`}
              >
                <td className="px-1 py-0.5 font-semibold">{r.actualShipperName}</td>
                <td className="px-1 py-0.5 text-center">
                  <CargoTypeBadge type={r.cargoType} />
                </td>
                <td className="px-1 py-0.5 font-mono text-neutral-600">{sizeStr}</td>
                <td className="px-1 py-0.5 text-right font-mono">{r.quantity}</td>
                <td className="px-1 py-0.5 text-right font-mono">
                  {rowWeight(r).toFixed(0)}
                </td>
                <td className="px-1 py-0.5 text-right font-mono">
                  {rowCbm(r).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CargoTypeBadge({ type }: { type: string }) {
  const cls =
    type === "CT"
      ? "bg-amber-200 text-amber-900"
      : type === "PK"
      ? "bg-purple-200 text-purple-900"
      : type === "WC" || type === "WB"
      ? "bg-rose-200 text-rose-900"
      : "bg-blue-100 text-blue-900";
  return (
    <span className={`inline-block rounded px-1 text-[9px] font-mono ${cls}`}>{type}</span>
  );
}

function Bar({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: "green" | "red";
}) {
  const fillCls =
    pct > 100
      ? "bg-red-600"
      : pct > 90
      ? "bg-orange-500"
      : tone === "green"
      ? "bg-green-500"
      : "bg-red-400";
  return (
    <div>
      <div className="flex justify-between text-[10px]">
        <span className="font-semibold">{label}</span>
        <span className="font-mono">
          {value} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-neutral-200">
        <div
          className={`h-full rounded ${fillCls}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function WeightBar({
  kg,
  pct,
  cap,
  tone,
}: {
  kg: number;
  pct: number;
  cap: number;
  tone: "green" | "red";
}) {
  const useCapPct = (kg / cap) * 100;
  const fillCls =
    useCapPct > 100
      ? "bg-red-600"
      : useCapPct > 90
      ? "bg-orange-500"
      : tone === "green"
      ? "bg-green-500"
      : "bg-red-400";
  return (
    <div>
      <div className="flex justify-between text-[10px]">
        <span className="font-mono">{(kg / 1000).toFixed(2)} t</span>
        <span className="text-neutral-500">
          전체 {pct.toFixed(0)}% · 한도 {useCapPct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 w-full rounded bg-neutral-200">
        <div
          className={`h-full rounded ${fillCls}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
