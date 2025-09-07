'use client'

import { useEffect, useMemo, useState } from 'react'
import { wsClient } from '@/shared/ws/connection'
import {
  startMetricsMock,
  stopMetricsMock,
  type MetricEvent,
  getWSStatus,
} from '@/features/metrics/lib/metricsStream'
import type { WSStatus } from '@/shared/ws/connection'

export function MetricsPanel() {
  const [status, setStatus] = useState<WSStatus>(getWSStatus())
  const [metrics, setMetrics] = useState<MetricEvent | null>(null)

  useEffect(() => {
    let unsub = () => {}
    startMetricsMock().then(() => setStatus(getWSStatus()))
    unsub = wsClient.subscribe<MetricEvent>('metrics', (ev) => setMetrics(ev))

    return () => {
      unsub()
      // ページ離脱で止めたい場合はコメント解除
      // stopMetricsMock()
    }
  }, [])

  const cards = useMemo(
    () => [
      { label: '注文数', value: metrics?.orders ?? '—' },
      { label: '売上(¥)', value: metrics?.revenue?.toLocaleString() ?? '—' },
      { label: 'エラー率', value: metrics ? `${(metrics.errorRate * 100).toFixed(2)}%` : '—' },
      { label: '平均応答', value: metrics ? `${metrics.avgLatencyMs} ms` : '—' },
    ],
    [metrics],
  )

  return (
    <section style={{ marginTop: 24 }}>
      <div
        style={{
          marginBottom: 12,
          padding: 8,
          borderRadius: 6,
          background:
            status === 'open' ? '#e6ffed' : status === 'connecting' ? '#eef6ff' : '#ffecec',
          color: status === 'open' ? '#056d2e' : status === 'connecting' ? '#0b3d91' : '#8a1f1f',
        }}
      >
        WS: {status}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 12,
              background: '#fff',
            }}
          >
            <div style={{ fontSize: 12, color: '#6b7280' }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
