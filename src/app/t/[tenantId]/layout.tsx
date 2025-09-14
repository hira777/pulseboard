import Link from 'next/link'
import type { ReactNode } from 'react'

import { requireTenantMember } from '@/features/auth/tenant'

type Props = {
  children: ReactNode
  params: Promise<{ tenantId: string }>
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenantId } = await params
  const membership = await requireTenantMember(tenantId)
  const isAdmin = membership.role === 'admin'

  return (
    <div>
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, #ddd)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <strong>PulseBoard</strong>
        <nav style={{ display: 'flex', gap: 12 }}>
          <Link href={`/t/${tenantId}`}>Dashboard</Link>
          {isAdmin && <Link href={`/admin`}>Admin</Link>}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
