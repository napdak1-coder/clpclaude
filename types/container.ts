/**
 * 컨테이너 도메인 타입
 */

export type ContainerType = "20FT" | "40FT";

export interface ContainerSpec {
  type: ContainerType;
  /** 최대 적재 중량 (kg) — 사용자 기준: 20FT < 21000, 40FT < 25000 */
  maxWeightKg: number;
  /**
   * 운영상 최대 허용 부피 (m³) — 컨테이너 수 산정·충전률 기준값.
   * 내부 치수의 이론치보다 실제 적재 가능 부피가 작은 경향(불규칙 화물·가용 공간 손실)
   * 을 반영해 별도 상한선을 둔다.
   */
  maxCbm: number;
  /** 내부 길이 (cm) */
  innerLength: number;
  /** 내부 폭 (cm) */
  innerWidth: number;
  /** 입구 높이 (cm) — 다단 적재시 통과 한계 */
  doorHeight: number;
  /** 내부 천장 높이 (cm) */
  innerHeight: number;
}
