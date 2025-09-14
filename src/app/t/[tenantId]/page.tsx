import { requireTenantMember } from '@/features/auth/tenant'

export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params

  await requireTenantMember(tenantId)
  return (
    <section style={{ padding: 16 }}>
      <h2>Tenant Dashboard</h2>
      <p>テナントID: {tenantId}</p>
      <p>ここにKPIや最近の更新など（S1最小）を配置します。</p>
    </section>
  )
}
