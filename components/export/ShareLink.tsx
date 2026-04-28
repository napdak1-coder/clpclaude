"use client";

/**
 * 공유 링크 발급 + 클립보드 복사
 *
 * - POST /api/share { planId } → { token, path }
 * - origin 합쳐 절대 URL 만들고 navigator.clipboard 로 복사
 */

import { useState } from "react";

interface ShareLinkProps {
  planId: string;
  /** 이미 발급된 토큰이 있으면 즉시 사용 */
  initialToken?: string | null;
}

interface ShareApiResponse {
  success: boolean;
  data?: { token: string; path: string };
  error?: string;
}

export function ShareLink({ planId, initialToken }: ShareLinkProps) {
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = (t: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/share/${t}`
      : `/share/${t}`;

  const issueAndCopy = async () => {
    setError(null);
    setBusy(true);
    try {
      let t = token;
      if (!t) {
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId }),
        });
        const json = (await res.json()) as ShareApiResponse;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "공유 링크 발급 실패");
        }
        t = json.data.token;
        setToken(t);
      }
      const url = fullUrl(t);
      try {
        await navigator.clipboard.writeText(url);
        setToast("링크가 클립보드에 복사되었습니다");
      } catch {
        // clipboard 권한이 없을 수 있으므로 fallback
        setToast(`복사 실패 — 직접 복사하세요: ${url}`);
      }
      setTimeout(() => setToast(null), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "공유 링크 발급 실패";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={issueAndCopy}
        disabled={busy}
        className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "발급 중…" : token ? "공유 링크 복사" : "공유 링크 만들기"}
      </button>
      {token && (
        <a
          href={fullUrl(token)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 underline"
        >
          새 창에서 열기
        </a>
      )}
      {toast && (
        <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
          {toast}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
