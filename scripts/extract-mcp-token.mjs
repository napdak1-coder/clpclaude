/**
 * 격리 Chrome 의 chrome-extension://...../status.html 타겟에 직접 attach,
 * localStorage('auth-token') 추출 → everything-claude-code 의 .mcp.json env 주입.
 *
 * status.html 타겟이 보이지 않으면 CDP Target.createTarget 으로 강제 오픈.
 */
import http from "node:http";
import fs from "node:fs";
import WebSocket from "ws";

const EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";
const STATUS_URL = `chrome-extension://${EXTENSION_ID}/status.html`;
const MCP_CONFIG_PATH =
  "C:/Users/napda/.claude/plugins/cache/everything-claude-code/everything-claude-code/1.10.0/.mcp.json";
const DEBUG_HOST = "localhost:9222";

const httpJson = (path) =>
  new Promise((res, rej) => {
    http
      .get(`http://${DEBUG_HOST}${path}`, (r) => {
        let buf = "";
        r.on("data", (d) => (buf += d));
        r.on("end", () => {
          try {
            res(JSON.parse(buf));
          } catch (e) {
            res(buf);
          }
        });
      })
      .on("error", rej);
  });

const sendCdp = (ws, id, method, params) =>
  new Promise((res, rej) => {
    const handler = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === id) {
        ws.off("message", handler);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function readLocalStorage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.once("open", res));
  await sendCdp(ws, 1, "Runtime.enable");
  const r = await sendCdp(ws, 2, "Runtime.evaluate", {
    expression: "localStorage.getItem('auth-token')",
    returnByValue: true,
  });
  ws.close();
  return r.result.value;
}

let targets = await httpJson("/json");
let target = targets.find((t) => t.url?.includes(STATUS_URL));

if (!target) {
  console.log("status.html 타겟 없음 → CDP 로 강제 오픈");
  const versionInfo = await httpJson("/json/version");
  const browserWs = versionInfo.webSocketDebuggerUrl;
  const bws = new WebSocket(browserWs);
  await new Promise((res) => bws.once("open", res));
  await sendCdp(bws, 1, "Target.createTarget", { url: STATUS_URL });
  bws.close();
  await new Promise((r) => setTimeout(r, 1500));
  targets = await httpJson("/json");
  target = targets.find((t) => t.url?.includes(STATUS_URL));
}

if (!target) {
  console.error("타겟 생성 실패. 확장이 로드되지 않았을 수 있음.");
  process.exit(1);
}
console.log("→ 타겟:", target.url);

const token = await readLocalStorage(target.webSocketDebuggerUrl);
console.log(
  "추출된 토큰:",
  token ? `${token.slice(0, 8)}…(${token.length}자)` : "NULL",
);

if (!token) {
  console.error("토큰 추출 실패.");
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf8"));
const pw = cfg.mcpServers?.playwright;
if (!pw) {
  console.error(".mcp.json 에 playwright 항목 없음.");
  process.exit(3);
}
pw.env = { ...(pw.env ?? {}), PLAYWRIGHT_MCP_EXTENSION_TOKEN: token };
fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
console.log("저장:", MCP_CONFIG_PATH);
console.log("playwright.env =", pw.env);
console.log("\n✅ 완료. Claude Code 재시작 시 MCP 브리지 자동 연결.");
