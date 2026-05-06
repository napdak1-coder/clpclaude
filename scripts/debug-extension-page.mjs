/**
 * 디버그: status.html 의 DOM/console/localStorage 전수 점검
 */
import http from "node:http";
import WebSocket from "ws";

const httpJson = (p) =>
  new Promise((res, rej) => {
    http
      .get(`http://localhost:9222${p}`, (r) => {
        let buf = "";
        r.on("data", (d) => (buf += d));
        r.on("end", () => res(JSON.parse(buf)));
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

const targets = await httpJson("/json");
const t = targets.find((x) =>
  x.url?.includes("mmlmfjhmonkocbjadbfplnigmagldckm/status.html"),
);
console.log("target:", t.url);

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
await sendCdp(ws, 1, "Runtime.enable");
await sendCdp(ws, 2, "Page.enable");

let id = 100;
const eval2 = async (expr) => {
  const r = await sendCdp(ws, ++id, "Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
  });
  return r.result.value;
};

console.log("readyState:", await eval2("document.readyState"));
console.log("body length:", await eval2("document.body.innerHTML.length"));
console.log("body preview:", await eval2("document.body.innerHTML.slice(0, 200)"));
console.log("localStorage keys:", await eval2("Object.keys(localStorage)"));
console.log("auth-token:", await eval2("localStorage.getItem('auth-token')"));
console.log("URL:", await eval2("location.href"));

// 강제 reload 후 재시도
console.log("\n=== reload + 재시도 ===");
await sendCdp(ws, ++id, "Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 1500));
console.log("readyState after reload:", await eval2("document.readyState"));
console.log("body length:", await eval2("document.body.innerHTML.length"));
console.log("auth-token:", await eval2("localStorage.getItem('auth-token')"));

ws.close();
