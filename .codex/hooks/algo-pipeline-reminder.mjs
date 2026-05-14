#!/usr/bin/env node
/**
 * PostToolUse 훅: lib/packing/algorithm.ts (또는 의존 모듈) 수정 감지 시
 * docs/algorithm-pipeline.md 갱신 리마인더를 모델 컨텍스트에 주입.
 *
 * 룰: .claude/rules/keep-algorithm-pipeline-updated.md
 */
let buf = "";
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(buf || "{}");
    const f =
      (j.tool_input && j.tool_input.file_path) ||
      (j.tool_response && j.tool_response.filePath) ||
      "";
    const norm = String(f).replace(/\\/g, "/");
    if (/lib\/packing\/(algorithm|extreme-point|display-rows|clustering)\.ts$/.test(norm)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext:
              "⚠️ 알고리즘 파일 수정됨 (" +
              f +
              "). 룰 keep-algorithm-pipeline-updated 에 따라 docs/algorithm-pipeline.md 도 함께 갱신해야 한다. 새 단계/룰/임계값/절대룰 변화가 있으면 해당 섹션과 \"마지막 갱신\" 줄을 즉시 보강할 것.",
          },
        }),
      );
    } else {
      process.stdout.write("{}");
    }
  } catch {
    process.stdout.write("{}");
  }
});
