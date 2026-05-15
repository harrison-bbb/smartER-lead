'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Link from 'next/link'
import { Plus, Users, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useConfirm } from '@/lib/use-confirm'

interface List { id: string; name: string; leadCount: number; createdAt: string }
const fetcher = (url: string) => apiFetch<{ data: List[] }>(url)

export default function ListsPage() {
  const [name, setName] = useState('')
  const { data } = useSWR('/lists', fetcher)
  const lists = data?.data ?? []
  const { confirm, cancel, isPending } = useConfirm()

  const handleCreate = async () => {
    if (!name.trim()) return
    await apiFetch('/lists', { method: 'POST', body: JSON.stringify({ name }) })
    setName('')
    mutate('/lists')
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/lists/${id}`, { method: 'DELETE' })
    cancel()
    mutate('/lists')
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Lists</h1>
          <p className="text-muted-foreground">Organize your leads into lists for campaigns</p>
        </div>

        <div className="flex gap-2 max-w-sm">
          <Input
            placeholder="New list name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>

        <div className="space-y-2">
          {lists.map((list) => (
            <Card key={list.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <Users className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-sm">{list.name}</p>
                  <p className="text-xs text-muted-foreground">{list.leadCount} leads · Created {formatDate(list.createdAt)}</p>
                </div>
                <Link href={`/leads/import?listId=${list.id}`}>
                  <Button variant="outline" size="sm">Import leads</Button>
                </Link>
                {isPending(list.id) ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => handleDelete(list.id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={cancel}>
                      No
                    </Button>
                  </div>
                ) : (
                  <Button size="icon" variant="ghost" onClick={() => confirm(list.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {lists.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No lists yet. Create one to organize your leads.</p>
          )}
        </div>
      </div>
    </AppShell>
  )
}
