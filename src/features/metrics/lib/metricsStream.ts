// src/features/metrics/lib/metricsStream.ts
'use client'

import { wsClient, type WSStatus } from '@/shared/ws/connection'

export type MetricEvent = {
  ts: number
  orders: number
  revenue: number
  errorRate: number
  avgLatencyMs: number
}

let timerId: number | null = null

/** metrics 用のモックストリーム開始（2秒ごとに publish） */
export async function startMetricsMock() {
  await wsClient.connect()
  if (timerId) return
  timerId = window.setInterval(() => {
    const ev: MetricEvent = {
      ts: Date.now(),
      orders: 100 + Math.floor(Math.random() * 20),
      revenue: 500000 + Math.floor(Math.random() * 50000),
      errorRate: parseFloat((Math.random() * 0.05).toFixed(3)),
      avgLatencyMs: 50 + Math.floor(Math.random() * 30),
    }
    // 汎用WSへ「metrics」トピックで publish
    wsClient.publish<MetricEvent>('metrics', ev)
  }, 2000)
}

/** metrics モック停止 */
export function stopMetricsMock() {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

/** 現在のWSステータス（UIで使う想定） */
export function getWSStatus(): WSStatus {
  return wsClient.getStatus()
}
