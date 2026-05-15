import { useState } from 'react'

export function useConfirm() {
  const [pendingId, setPendingId] = useState<string | null>(null)

  const confirm = (id: string) => setPendingId(id)
  const cancel = () => setPendingId(null)
  const isPending = (id: string) => pendingId === id

  return { confirm, cancel, isPending, pendingId }
}
