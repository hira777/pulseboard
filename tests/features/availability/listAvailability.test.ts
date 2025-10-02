import { InvalidAvailabilityInputError, listAvailability } from '@/features/availability/server'

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(async () => ({})),
}))

const baseInput = {
  tenantId: 'tenant-1',
  range: {
    from: '2025-10-01T10:00:00+09:00',
    to: '2025-10-01T12:00:00+09:00',
  },
  serviceId: 'service-1',
} as const

describe('listAvailability のバリデーション', () => {
  it('必須項目だけなら空配列を返す', async () => {
    const result = await listAvailability({ ...baseInput })
    expect(result).toEqual({ slots: [] })
  })

  it('pageSize が 50 を超えると InvalidAvailabilityInputError を投げる', async () => {
    await expect(
      listAvailability({
        ...baseInput,
        pageSize: 100,
      }),
    ).rejects.toBeInstanceOf(InvalidAvailabilityInputError)
  })

  it('日時が不正なら 422 エラー情報を含む例外になる', async () => {
    await expect(
      listAvailability({
        ...baseInput,
        range: {
          from: 'invalid',
          to: '2025-10-01T12:00:00+09:00',
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_INPUT',
    })
  })
})
