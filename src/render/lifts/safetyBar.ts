/** Chair safety bars come down this far from the stations and are fully down by the second distance. */
export const BAR_DOWN_FROM_M = 18;
export const BAR_DOWN_BY_M = 30;

/**
 * How far a chair's safety bar is lowered, 0 (up) to 1 (down): riders lower it once clear of the
 * bottom station and raise it before the top; empty chairs coming down keep it up.
 */
export function barLowered(alongM: number, lengthM: number, upLine: boolean): number {
  if (!upLine) return 0;
  const fromEnd = Math.min(alongM, lengthM - alongM);
  const t = Math.max(0, Math.min(1, (fromEnd - BAR_DOWN_FROM_M) / (BAR_DOWN_BY_M - BAR_DOWN_FROM_M)));
  return t * t * (3 - 2 * t);
}
