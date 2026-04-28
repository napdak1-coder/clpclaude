/**
 * 공유 데이터 직렬화 유틸리티
 *
 * - 작은 상태(예: 부킹 임시저장, 옵션) 만 hash 로 보낼 때 사용
 * - 큰 결과는 DB 의 share_token 경로를 사용
 */

import LZString from "lz-string";

/** 임의 객체를 lz-string 으로 압축한 URI-safe 문자열로 인코딩 */
export function encodeStateToHash<T>(data: T): string {
  const json = JSON.stringify(data);
  return LZString.compressToEncodedURIComponent(json);
}

/** encodeStateToHash 결과를 다시 객체로 복원, 실패 시 null */
export function decodeHashToState<T>(hash: string): T | null {
  if (!hash) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) return null;
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
