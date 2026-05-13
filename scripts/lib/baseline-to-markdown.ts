/**
 * baseline JSON → 사람용 markdown 표 자동 생성.
 *
 * 사용:
 *   import { renderBaselineMarkdown } from "./baseline-to-markdown.ts";
 *   const md = renderBaselineMarkdown(snapshot);
 *
 * 7+1 컬럼 (디자이너 권장):
 *   샘플 · 상태 · 컨 셋 · 미배치·split · audit · 결정·CBM (3줄) · pack 시간 · 비고
 *
 * 빈 셀 3종 구분: 0 (의미 있는 0) / — (해당 없음) / · (수집 실패)
 */

import type {
  BaselineSnapshot,
  BaselineSample,
} from "./regression-baseline-types.ts";

function statusBadge(s: BaselineSample): string {
  if (s.expectedStatus === "WIP") return "🔴";
  // hard 동결 위반 검사
  const hard =
    s.unplacedCount > 0 ||
    !s.strictAuditPass ||
    s.hardViolationCount > 0 ||
    s.cbmOverflowCount > 0 ||
    s.weightOverflowCount > 0 ||
    s.cargoIdSplitCount > 0 ||
    s.bookingSplitCount > 0;
  if (hard) return "🔴";
  if (s.expectedStatus === "KNOWN_MISMATCH") return "🟡";
  return "🟢";
}

function fmtContainerSet(s: BaselineSample): string {
  const counts = new Map<string, number>();
  for (const t of s.containerSet) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts: string[] = [];
  for (const [t, n] of counts) parts.push(n > 1 ? `${t.replace("FT", "")}×${n}` : t.replace("FT", ""));
  return parts.join("+") + "FT";
}

function fmtUnplacedSplit(s: BaselineSample): string {
  return `${s.unplacedCount} · ${s.cargoIdSplitCount}/${s.bookingSplitCount}`;
}

function fmtAudit(s: BaselineSample): string {
  return s.strictAuditPass ? "✅" : "❌";
}

function fmtDecisionCbm(s: BaselineSample): string {
  const decl = s.userDeclaredTotalCbm.toFixed(1);
  const phys = s.physicalTotalCbm.toFixed(1);
  const legacy = s.legacyDecisionTotalCbm.toFixed(1);
  return `${s.cbmBasis}<br>신고 ${decl}<br>박스 ${phys}<br>기존 ${legacy}`;
}

function fmtPackTime(ms: number): string {
  if (ms === 0) return "·";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}초`;
}

function fmtNotes(s: BaselineSample): string {
  const parts: string[] = [];
  if (s.practitionerMismatchCount != null && s.practitionerMismatchCount > 0) {
    parts.push(`실무자 ${s.practitionerMismatchCount}건 차이`);
  }
  parts.push(`결정: ${s.cbmBasis}`);
  if (s.userDeclaredTotalCbm > 0 && s.legacyDecisionTotalCbm > 0) {
    const diff = Math.abs(s.userDeclaredTotalCbm - s.legacyDecisionTotalCbm);
    if (diff >= 0.3) {
      parts.push(`신고-기존 차 ${diff.toFixed(1)}m³`);
    }
  }
  return parts.join(" · ");
}

export function renderBaselineMarkdown(snapshot: BaselineSnapshot): string {
  const counts = { pass: 0, known: 0, fail: 0 };
  for (const s of snapshot.samples) {
    const badge = statusBadge(s);
    if (badge === "🟢") counts.pass++;
    else if (badge === "🟡") counts.known++;
    else counts.fail++;
  }

  const lines: string[] = [];
  lines.push(`# 회귀 baseline ${snapshot.dataVersion} — 🟢 활성`);
  lines.push("");
  lines.push(`> 생성: ${snapshot.generatedAt}`);
  lines.push(`> 커밋: \`${snapshot.git.commit}\` · 알고리즘: ${snapshot.algorithmVersion}`);
  lines.push(
    `> 스키마 v${snapshot.schemaVersion} · 데이터 v${snapshot.dataVersion} · node ${snapshot.host.node}`,
  );
  lines.push("");
  lines.push(
    `**🟢 PASS ${counts.pass} · 🟡 KNOWN ${counts.known} · 🔴 FAIL ${counts.fail}** / 총 ${snapshot.samples.length}건`,
  );
  lines.push("");
  lines.push("## 9 샘플 매트릭스");
  lines.push("");
  lines.push("| 샘플 | 상태 | 컨 셋 | 미배치·split | audit | 결정·CBM | pack 시간 | 비고 |");
  lines.push("|---|:---:|---|:---:|:---:|---|:---:|---|");
  for (const s of snapshot.samples) {
    lines.push(
      `| ${s.sampleName} | ${statusBadge(s)} | ${fmtContainerSet(s)} | ${fmtUnplacedSplit(s)} | ${fmtAudit(s)} | ${fmtDecisionCbm(s)} | ${fmtPackTime(s.packTimeMedianOf3)} | ${fmtNotes(s)} |`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**컬럼 의미**");
  lines.push("- 상태: 🟢 PASS · 🟡 KNOWN_MISMATCH · 🔴 WIP/FAIL");
  lines.push("- 미배치·split: 미배치 수 · cargo 분산/booking 분산");
  lines.push("- 결정·CBM: 컨 셋 결정 근거 / 사용자 신고 / 박스 합 / 기존 알고리즘 결정용 합 (m³)");
  lines.push("- pack 시간: 측정 3회 중 median");
  lines.push("");
  lines.push(
    "**Hard 동결 필드**: containerSet · unplaced · split · audit · cbm/weight overflow · physical. 변하면 회귀 fail.",
  );
  lines.push(
    "**참고 필드**: userDeclared · legacy · candidates · pack 시간 · 실무자 mismatch. 변동 허용 (warning 표시).",
  );

  return lines.join("\n");
}

/** CLI: node --experimental-strip-types scripts/lib/baseline-to-markdown.ts <baseline.json> <out.md> */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error("사용: node baseline-to-markdown.ts <baseline.json> <out.md>");
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(path.resolve(inPath), "utf8"));
  const md = renderBaselineMarkdown(json);
  fs.writeFileSync(path.resolve(outPath), md);
  console.log(`md 생성 완료: ${outPath}`);
}
