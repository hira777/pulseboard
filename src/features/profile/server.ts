'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUser } from '@/features/auth/server'
import { setFlash } from '@/shared/server/flash'

export async function updateDisplayNameAction(formData: FormData) {
  const displayName = (formData.get('display_name') ?? '').toString().trim()
  if (displayName.length > 120) {
    setFlash('表示名は120文字以内にしてください', 'error')
    redirect('/dashboard')
  }

  const user = await getUser()
  if (!user) redirect('/auth/login')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', user.id)

  if (error) {
    setFlash('プロフィール更新に失敗しました', 'error')
    redirect('/dashboard')
  }

  setFlash('プロフィールを更新しました', 'success')
  revalidatePath('/dashboard')
  redirect('/dashboard')
}
