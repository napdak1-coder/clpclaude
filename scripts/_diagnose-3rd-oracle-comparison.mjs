/* 3차 1단계 — 실무자 답안 오라클 vs 시스템 strict visual 결과 비교.
 *
 * 4 샘플 (망작 / 1ST SG / 4ST SG / 5ST SG) 동시 분석.
 * 코드 수정 없음 — read-only 비교 + 매핑만.
 *
 * 출력:
 *   - sampleName
 *   - targetContainerSet (실무자 답안 기준)
 *   - practitionerContainerSet
 *   - systemStrictVisualContainerSet
 *   - unplacedCargoIds + 사이즈/수량/무게/booking/화주
 *   - 각 unplaced cargo 의 실무자 답안 컨 위치 (화주 매핑)
 *   - 그 컨에 같이 배치된 실무자 화주 목록 (인접 cargo 후보)
 *   - 시스템이 그 cargo 를 끝까지 못 넣었으니, 같은 시스템 컨에 어떤 cargo 가 있는지
 *   - 시스템 strict visual 컨 셋 vs 실무자 컨 셋 일치 여부
 */
import fs from "node:fs";
import path from "node:path";
const algo = await import("../lib/packing/algorithm.ts");
const { pack } = algo;

/** 실무자 답안 — 화주 목록 (컨테이너별). 망작 SG 는 40FT 1대로 전체. */
const PRACTITIONER = {
  mangjak: {
    targetSet: ["40FT"],
    // 망작 SG = 샘플 모든 화주 40FT 1대
    // (실무자 명시: data/samples/singapore-mangjak-total.json 의 actualShipperName 전체)
    containers: [{ type: "40FT", shippers: "ALL" }],
  },
  "sg-1": {
    targetSet: ["40FT", "20FT"],
    containers: [
      {
        type: "40FT",
        shippers: [
          "메가젠임플란트", "데코론", "YKMC", "보현석재", "에이제이테크", "카페봄봄",
          "EXCELERATE ENERGY", "VISCOSMO", "더블유티 스프레이", "리만", "대한정밀공업",
          "선진뷰티사이언스", "SUNGBO INDUSTRIA", "제일기공", "웨스코", "디에스콘",
          "티케이테크",
        ],
      },
      {
        type: "20FT",
        shippers: ["AWOT", "대원산업", "씨에스에프", "HD현대건설기계", "포컴퍼니"],
      },
    ],
  },
  "sg-4": {
    targetSet: ["40FT", "40FT", "40FT"],
    containers: [
      {
        type: "40FT",
        shippers: [
          "나토", "CNS", "무등", "수일", "YKMC", "삼화전기", "직방", "KPF",
          "에어뱅크", "대풍건설", "코스모신소재", "나은이앤지", "KUK DONG HOIST",
          "TP(코리아실크로드)", "세방에스비", "위너스마린", "맥테크", "워터피이", "SY INT'L",
        ],
      },
      {
        type: "40FT",
        shippers: [
          "삼성전자", "삼성전자", "삼성전자", "삼성전자", "삼성전자",
          "삼성전자", "삼성전자", "삼성전자",
          "LS BUILDWIN LTD.", "MNCI **반송**", "위너스마린",
          "YKMC", "베베쿡", "IPIA COSMETICS", "훌루테크", "광명산업",
          "DSR WIRE CORP", "DSR WIRE CORP", "동방기계", "위너스마린",
        ],
      },
      {
        type: "40FT",
        shippers: [
          "나토", "CMOS 청강", "CMOS 호성이레테", "CMOS 대림바스",
          "CMOS 삼화정밀", "CMOS CDC", "코오롱(SUPERTRAIN)", "나토상사",
          "반도텍", "나라켐", "동아베스텍", "디에스상사",
          "서울금속(한큐한신)*상단/작업주의*", "삼성전자", "스킨렉스",
        ],
      },
    ],
  },
  "sg-5": {
    targetSet: ["40FT", "40FT"],
    containers: [
      {
        type: "40FT",
        shippers: [
          "YKMC", "솔텍", "민서코팅", "아성플라스틱밸브", "TPG (티피지)", "더젬코리아",
          "베스프코리아", "카고러쉬", "나라켐", "태원니들", "베베푸드", "코리얼트레이딩스",
          "삼성전자", "DN 솔루션즈", "대현 ST", "KMS", "삼성전자",
        ],
      },
      {
        type: "40FT",
        shippers: [
          "유앤아이원", "낙천", "YKMC", "한도신소재", "YOKOHAMA **TS**", "MOJI **TS**",
          "SHIMIZU **TS**", "서울통신이앤지", "DGI", "JWE HOSE", "세웅플랜트",
          "JPTPUS26040003(T/S)", "하이브코리아", "세원", "서울통신이앤지", "덕산하이메탈",
          "아이마니", "KJF", "에프디씨바이오",
        ],
      },
    ],
  },
};

const SAMPLES = [
  { id: "mangjak", name: "망작 SG", file: "data/samples/singapore-mangjak-total.json" },
  { id: "sg-1", name: "1ST SG", file: "data/samples/singapore-total.json" },
  { id: "sg-4", name: "4ST SG", file: "data/samples/singapore-total-4.json" },
  { id: "sg-5", name: "5ST SG", file: "data/samples/singapore-total-5.json" },
];

function build(rows, prefix) {
  return rows.map((r, i) => ({
    id: `${prefix}-${i + 1}`,
    itemName: r.itemName || null,
    actualShipperName: r.actualShipperName ?? "",
    shipperName: r.shipperName ?? "",
    width: r.widthCm ?? 0,
    length: r.lengthCm ?? 0,
    height: r.heightCm ?? 0,
    quantity: Math.max(1, r.quantity ?? 1),
    weightPerUnit: r.weightPerUnitKg ?? 0,
    cbm: r.cbm ?? null,
    aboutCbm: r.aboutCbm ?? null,
    cargoType: r.cargoType ?? (r.widthCm > 0 ? "PL" : "CT"),
    bookingNo: r.bookingNo || undefined,
    unitSizes: r.unitSizes,
    remarks: {
      noStacking: r.noStacking ?? false,
      topOnly: r.topOnly ?? false,
      orientation: r.orientation ?? "free",
      heavierBelow: r.heavierBelow ?? false,
    },
    itemRemark: r.itemRemark ?? "",
  }));
}

/** 실무자 컨테이너 화주 매칭 — best 위치 1개 반환 (multiset 인접) */
function findShipperPractitionerContainer(sampleId, shipperName) {
  const p = PRACTITIONER[sampleId];
  if (!p) return -1;
  // 망작 = ALL → 컨 0
  if (p.containers.length === 1 && p.containers[0].shippers === "ALL") return 0;
  for (let i = 0; i < p.containers.length; i++) {
    if (p.containers[i].shippers.includes(shipperName)) return i;
  }
  return -1;
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

log("=== 3차 1단계: 실무자 답안 오라클 vs 시스템 strict visual 결과 비교 ===");
log(`date: ${new Date().toISOString()}`);
log("");

for (const s of SAMPLES) {
  if (!fs.existsSync(s.file)) {
    log(`[${s.id}] SKIP — 파일 없음`);
    continue;
  }
  const sample = JSON.parse(fs.readFileSync(s.file, "utf8"));
  const cargoes = build(sample.rows, s.id);
  const t0 = Date.now();
  const result = pack(cargoes, "auto", { strictVisualClassification: true });
  const dt = (Date.now() - t0) / 1000;

  // 시스템 결과 cargoId → 컨 인덱스
  const sysContainerOfId = new Map();
  result.containers.forEach((c, ci) => {
    for (const row of c.rows ?? []) {
      for (const it of [...(row.bottomItems ?? []), ...(row.topItems ?? [])]) {
        if (it.cargoId) sysContainerOfId.set(it.cargoId, ci);
      }
    }
    for (const bi of c.bulkItems ?? []) {
      if (bi.cargoId && !sysContainerOfId.has(bi.cargoId)) {
        sysContainerOfId.set(bi.cargoId, ci);
      }
    }
  });

  const unplacedIds = new Set();
  for (const u of result.unplaced) {
    if (u.cargoId) unplacedIds.add(u.cargoId);
  }

  const sysContSet = result.containers.map((c) => c.spec.type);
  const practSet = PRACTITIONER[s.id]?.targetSet ?? [];

  log(`## ${s.id} (${s.name})`);
  log(`- target / practitioner containerSet: ${practSet.join("+")}`);
  log(`- system strict visual containerSet:  ${sysContSet.join("+")}${arraysEqual(sysContSet, practSet) ? " ✅ 같음" : " ❌ 다름"}`);
  log(`- pack 시간: ${dt.toFixed(1)}s`);
  log(`- 미배치: ${result.unplaced.reduce((a, u) => a + (u.quantity ?? 1), 0)} unit (${unplacedIds.size} cargo)`);

  if (unplacedIds.size === 0) {
    log("");
    continue;
  }

  log("");
  log(`### unplaced cargo 별 실무자 답안 위치 ↔ 시스템 미배치 비교`);
  for (const cid of unplacedIds) {
    const cargo = cargoes.find((c) => c.id === cid);
    if (!cargo) {
      log(`  ${cid}: cargo 못 찾음`);
      continue;
    }
    const shipper = cargo.actualShipperName || "(?)";
    const practContIdx = findShipperPractitionerContainer(s.id, shipper);
    const practCont =
      practContIdx >= 0
        ? PRACTITIONER[s.id].containers[practContIdx]
        : null;
    const sysCi = sysContainerOfId.get(cid) ?? null;

    log("");
    log(
      `  [${cid}] 화주="${shipper}" W${cargo.width} L${cargo.length} H${cargo.height} ×${cargo.quantity} booking=${cargo.bookingNo ?? "—"}`,
    );
    if (cargo.remarks?.noStacking) log(`    ⚠ noStacking=true`);
    if (cargo.remarks?.topOnly) log(`    ⚠ topOnly=true`);
    if (cargo.remarks?.orientation === "fixed") log(`    ⚠ orientation=fixed`);

    log(
      `    실무자 답안 위치 → 컨${practContIdx + 1} ${practCont?.type ?? "?"}` +
        (practCont?.shippers === "ALL" ? " (전체 화물)" : ""),
    );
    log(
      `    시스템 시도 위치 → ${sysCi != null ? `컨${sysCi + 1} ${result.containers[sysCi].spec.type}` : "어디도 배치 못 함 (전 컨 시도 후 실패)"}`,
    );

    // 실무자 답안에서 같은 컨에 있는 다른 화주 목록 + 시스템 결과
    if (practCont && practCont.shippers !== "ALL") {
      const sameContShippers = practCont.shippers;
      // 시스템에서 이 화주들이 실제 어느 컨에 갔는지
      const sysContByShipper = new Map();
      for (const c of cargoes) {
        if (sameContShippers.includes(c.actualShipperName)) {
          const ci = sysContainerOfId.get(c.id);
          if (!sysContByShipper.has(c.actualShipperName)) {
            sysContByShipper.set(c.actualShipperName, new Set());
          }
          sysContByShipper.get(c.actualShipperName).add(ci ?? "미배치");
        }
      }
      log(`    실무자 답안 같은 컨 화주들 (${sameContShippers.length}명): ${sameContShippers.slice(0, 10).join(", ")}${sameContShippers.length > 10 ? "..." : ""}`);
      // 같은 컨 화주 중 시스템에서 다른 컨 으로 간 케이스
      const splitCnt = [...sysContByShipper.entries()].filter(([, set]) => set.size > 1).length;
      const sysContSetUsed = new Set();
      for (const set of sysContByShipper.values()) {
        for (const v of set) sysContSetUsed.add(v);
      }
      log(`    → 시스템에서 이 화주들이 흩어진 컨: ${[...sysContSetUsed].map((v) => v === "미배치" ? "미" : `컨${Number(v) + 1}`).join(",")}, 분산 화주 수: ${splitCnt}`);
    } else if (practCont?.shippers === "ALL") {
      // 망작: 모든 화주가 실무자 답안 컨 1 에 있음. 시스템은 어디로 갔는지 확인
      const allSysCi = new Set();
      for (const c of cargoes) {
        const ci = sysContainerOfId.get(c.id);
        allSysCi.add(ci ?? "미배치");
      }
      log(
        `    실무자 답안: 전체 화물 컨1 40FT 단독. 시스템 분포: ${[...allSysCi].map((v) => v === "미배치" ? "미" : `컨${Number(v) + 1}`).join(",")}`,
      );
    }
  }
  log("");
}

function arraysEqual(a, b) {
  const sa = [...a].sort().join("|");
  const sb = [...b].sort().join("|");
  return sa === sb;
}

log("");
log("=== 종합 관찰 ===");
log("1. 망작 SG: 실무자 40FT 1대 / 시스템 strict visual 컨 셋 비교 → 컨 셋 차이 자체가 핵심");
log("2. sg-1, sg-4, sg-5: 컨 셋이 같다면 실무자가 어떤 cargo 를 어느 컨에 묶었는지가 단서");
log("3. 화주 분산 (실무자는 같은 컨, 시스템은 다른 컨) 이 많으면 묶음/순서 룰 문제 의심");

const outPath = path.resolve("scripts/_diagnose-3rd-oracle-comparison-out.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`\n--- saved to ${outPath} ---`);
