/**
 * libsql/client 싱글톤 — Next.js 서버 사이드 전용
 *
 * 매 요청마다 새 클라이언트를 생성하면 파일 잠금 경합과 메모리 낭비가 생긴다.
 * 모듈 스코프 변수에 한 번만 만들고 재사용한다.
 */

import { createClient, type Client } from "@libsql/client";
import path from "node:path";

// data/clpnice.db 절대 경로 — Windows 백슬래시는 file: URL 에서 슬래시로 치환
const dbPath = path.resolve(process.cwd(), "data", "clpnice.db");
const fileUrl = `file:${dbPath.replaceAll("\\", "/")}`;

export const db: Client = createClient({ url: fileUrl });
