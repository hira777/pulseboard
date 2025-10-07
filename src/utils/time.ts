/**
 * 時間計算系の共通ユーティリティ群。
 */

const MINUTES_TO_MS = 60_000

/**
 * 分単位の値をミリ秒に変換する。
 * @param minutes 分単位の値
 * @returns ミリ秒換算の数値
 */
export function minutesToMs(minutes: number): number {
  return minutes * MINUTES_TO_MS
}

/**
 * ISO 8601 文字列の末尾からタイムゾーンオフセット（分）を求める。
 * @param iso タイムゾーン付き ISO 8601 文字列
 * @returns 分単位のオフセット。UTC の場合は 0。
 */
export function extractTimezoneOffsetMinutes(iso: string): number {
  if (iso.endsWith('Z')) {
    return 0
  }
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/)
  if (!match) {
    return 0
  }
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number.parseInt(match[2], 10)
  const minutes = Number.parseInt(match[3], 10)
  return sign * (hours * 60 + minutes)
}
