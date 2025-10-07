// 予約を禁止する時間帯をテナント・部屋・機材・スタッフの各スコープで扱うユーティリティです。
// Postgres の range 文字列を数値の区間に変換し、スコープごとにまとめて衝突を判定します。
export type CalendarScope = 'tenant' | 'room' | 'equipment' | 'staff'

// DB から読み込む例外レコード。`range` は "[2025-... , 2025-...)" のような Postgres range 文字列です。
export type CalendarExceptionRecord = {
  scope: CalendarScope
  target_id: string | null
  range: string
}

// Unix epoch ミリ秒で表した閉区間です。
export type Interval = {
  start: number
  end: number
}

// すべての例外をソート済みで保持するコンテキストです。重複判定を安定して行えます。
export type CalendarContext = {
  tenantExceptions: Interval[]
  roomExceptionsById: Map<string, Interval[]>
  equipmentExceptionsById: Map<string, Interval[]>
  equipmentGlobalExceptions: Interval[]
  staffExceptionsById: Map<string, Interval[]>
  staffGlobalExceptions: Interval[]
}

export type ClosedScopeReason = {
  scope: CalendarScope
  targetId: string | null
  interval: Interval
}

// 予約が例外と衝突したときに投げるエラーです。
export class ReservationClosedScopeError extends Error {
  readonly code = 'RESERVATIONS_CLOSED_SCOPE'
  constructor(public readonly reason: ClosedScopeReason) {
    super('Reservation is blocked by calendar exception')
    this.name = 'ReservationClosedScopeError'
  }
}

export type ReservationScopeCheckParams = {
  context: CalendarContext
  roomId: string
  interval: Interval
  equipmentIds?: string[]
  staffIds?: string[]
}

/**
 * 生の例外レコードを解析し、繰り返しの判定に使える形へ整えます。
 * @param records 予約例外レコードの配列
 * @returns スコープごとにソートされた例外コンテキスト
 */
export function buildCalendarContext(
  records: CalendarExceptionRecord[],
): CalendarContext {
  const tenantExceptions = intervalsFromRecords(
    records.filter((record) => record.scope === 'tenant'),
  )

  const roomExceptionsById = groupIntervalsByTarget(records, 'room')
  const equipmentExceptionsById = groupIntervalsByTarget(records, 'equipment')
  const staffExceptionsById = groupIntervalsByTarget(records, 'staff')

  const equipmentGlobalExceptions = intervalsFromRecords(
    records.filter((record) => record.scope === 'equipment' && !record.target_id),
  )
  const staffGlobalExceptions = intervalsFromRecords(
    records.filter((record) => record.scope === 'staff' && !record.target_id),
  )

  return {
    tenantExceptions,
    roomExceptionsById,
    equipmentExceptionsById,
    equipmentGlobalExceptions,
    staffExceptionsById,
    staffGlobalExceptions,
  }
}

/**
 * 優先度順に各スコープを確認し、最初に重複した例外区間を返します。
 * @param params 判定に必要なコンテキストと対象情報
 * @returns 重複があれば理由、なければ null
 */
export function findClosedScope({
  context,
  roomId,
  interval,
  equipmentIds = [],
  staffIds = [],
}: ReservationScopeCheckParams): ClosedScopeReason | null {
  const tenantHit = firstOverlap(context.tenantExceptions, interval)
  if (tenantHit) {
    return { scope: 'tenant', targetId: null, interval: tenantHit }
  }

  // 部屋固有の例外。
  const roomHit = firstOverlap(
    context.roomExceptionsById.get(roomId) ?? [],
    interval,
  )
  if (roomHit) {
    return { scope: 'room', targetId: roomId, interval: roomHit }
  }

  // 個別機材より先に共通の機材例外を確認します。
  const equipmentGlobalHit = firstOverlap(context.equipmentGlobalExceptions, interval)
  if (equipmentGlobalHit) {
    return { scope: 'equipment', targetId: null, interval: equipmentGlobalHit }
  }

  for (const equipmentId of equipmentIds) {
    const hit = firstOverlap(
      context.equipmentExceptionsById.get(equipmentId) ?? [],
      interval,
    )
    if (hit) {
      return { scope: 'equipment', targetId: equipmentId, interval: hit }
    }
  }

  // 個別スタッフより先に共通のスタッフ例外を確認します。
  const staffGlobalHit = firstOverlap(context.staffGlobalExceptions, interval)
  if (staffGlobalHit) {
    return { scope: 'staff', targetId: null, interval: staffGlobalHit }
  }

  for (const staffId of staffIds) {
    const hit = firstOverlap(
      context.staffExceptionsById.get(staffId) ?? [],
      interval,
    )
    if (hit) {
      return { scope: 'staff', targetId: staffId, interval: hit }
    }
  }

  return null
}

/**
 * 衝突があれば理由付きで例外を投げます。
 * @param params 判定に必要なコンテキストと対象情報
 */
export function assertReservationOpen(params: ReservationScopeCheckParams) {
  const reason = findClosedScope(params)
  if (reason) {
    throw new ReservationClosedScopeError(reason)
  }
}

/**
 * Postgres range 文字列を `Interval` に変換します。
 * 不正・未完成な文字列や長さが 0 以下の場合は null を返します。
 * @param range Postgres range 形式の文字列
 * @returns パース結果の区間、または null
 */
export function parsePgRange(range: string): Interval | null {
  if (!range) {
    return null
  }
  const match = range.match(/^([\[(])([^,]*),([^,\)]*)([)\]])$/)
  if (!match) {
    return null
  }
  const startInclusive = match[1] === '['
  const endInclusive = match[4] === ']'
  const startStr = match[2].trim()
  const endStr = match[3].trim()
  if (!startStr || !endStr) {
    return null
  }
  let start = Date.parse(startStr)
  let end = Date.parse(endStr)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null
  }
  if (!startInclusive) {
    start += 1
  }
  if (endInclusive) {
    end += 1
  }
  if (start >= end) {
    return null
  }
  return { start, end }
}

/**
 * ターゲット ID（部屋・機材・スタッフ）ごとに区間をまとめてソートします。
 * 不正な range 文字列は無視します。
 * @param records 予約例外レコードの配列
 * @param scope まとめたいスコープ
 * @returns スコープ内のターゲット ID をキーにした区間マップ
 */
export function groupIntervalsByTarget(
  records: CalendarExceptionRecord[],
  scope: CalendarScope,
): Map<string, Interval[]> {
  const map = new Map<string, Interval[]>()
  for (const record of records) {
    if (record.scope !== scope || !record.target_id) {
      continue
    }
    const interval = parsePgRange(record.range)
    if (!interval) {
      continue
    }
    const list = map.get(record.target_id) ?? []
    list.push(interval)
    map.set(record.target_id, list)
  }
  map.forEach((intervals, key) => {
    intervals.sort((a, b) => a.start - b.start)
    map.set(key, intervals)
  })
  return map
}

/**
 * ターゲット ID を持たないスコープ向けのヘルパーです。
 * 不正レコードを除外し、重複判定しやすいようソートします。
 * @param records 予約例外レコードの配列
 * @returns ソート済みの区間配列
 */
function intervalsFromRecords(records: CalendarExceptionRecord[]): Interval[] {
  const intervals: Interval[] = []
  for (const record of records) {
    const interval = parsePgRange(record.range)
    if (interval) {
      intervals.push(interval)
    }
  }
  intervals.sort((a, b) => a.start - b.start)
  return intervals
}

/**
 * 与えられた区間群から対象区間と重なる最初の区間を探します。
 * @param intervals 判定対象の区間配列
 * @param target 比較する区間
 * @returns 重複した区間、または null
 */
function firstOverlap(intervals: Interval[], target: Interval): Interval | null {
  for (const interval of intervals) {
    if (interval.start < target.end && target.start < interval.end) {
      return interval
    }
  }
  return null
}
