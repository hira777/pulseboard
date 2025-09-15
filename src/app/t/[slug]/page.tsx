import { notFound } from 'next/navigation'
import { requireTenantMember, getTenantBySlug } from '@/features/auth/tenant'

export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const resolved = await getTenantBySlug(slug)
  if (!resolved) notFound()
  await requireTenantMember(resolved.id)
  return (
    <section style={{ padding: 16 }}>
      <h2>Tenant Dashboard</h2>
      <p>テナント: {resolved.slug} ({resolved.id})</p>
      <p>ここにKPIや最近の更新など（S1最小）を配置します。</p>
    </section>
  )
}
