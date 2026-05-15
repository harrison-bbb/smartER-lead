'use client'

import useSWR, { mutate } from 'swr'
import Link from 'next/link'
import { Plus, Play, Pause, Trash2, BarChart3 } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useConfirm } from '@/lib/use-confirm'

interface Campaign {
  id: string
  name: string
  status: string
  totalLeads: number
  dailyLimit: number
  createdAt: string
}

const fetcher = (url: string) => apiFetch<{ data: Campaign[] }>(url)

export default function CampaignsPage() {
  const { data, isLoading } = useSWR('/campaigns', fetcher)
  const campaigns = data?.data ?? []
  const { confirm, cancel, isPending } = useConfirm()

  const handleStart = async (id: string) => {
    await apiFetch(`/campaigns/${id}/start`, { method: 'POST' })
    mutate('/campaigns')
  }

  const handlePause = async (id: string) => {
    await apiFetch(`/campaigns/${id}/pause`, { method: 'POST' })
    mutate('/campaigns')
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/campaigns/${id}`, { method: 'DELETE' })
    cancel()
    mutate('/campaigns')
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Campaigns</h1>
            <p className="text-muted-foreground">Manage your email outreach campaigns</p>
          </div>
          <Link href="/campaigns/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </Button>
          </Link>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading...</p>}
        {!isLoading && campaigns.length === 0 && (
          <div className="text-center py-12 border rounded-lg bg-card">
            <p className="text-muted-foreground mb-4">No campaigns yet</p>
            <Link href="/campaigns/new">
              <Button>Create your first campaign</Button>
            </Link>
          </div>
        )}

        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-4 p-4 rounded-lg border bg-card">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline truncate">
                    {c.name}
                  </Link>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.totalLeads} leads · {c.dailyLimit}/day · Created {formatDate(c.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link href={`/campaigns/${c.id}`}>
                  <Button size="icon" variant="ghost" title="Analytics">
                    <BarChart3 className="h-4 w-4" />
                  </Button>
                </Link>
                {c.status === 'draft' || c.status === 'paused' ? (
                  <Button size="icon" variant="ghost" onClick={() => handleStart(c.id)} title="Start">
                    <Play className="h-4 w-4 text-green-600" />
                  </Button>
                ) : c.status === 'active' ? (
                  <Button size="icon" variant="ghost" onClick={() => handlePause(c.id)} title="Pause">
                    <Pause className="h-4 w-4 text-yellow-600" />
                  </Button>
                ) : null}
                {isPending(c.id) ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => handleDelete(c.id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={cancel}>
                      No
                    </Button>
                  </div>
                ) : (
                  <Button size="icon" variant="ghost" onClick={() => confirm(c.id)} title="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'outline'> = {
    active: 'success',
    paused: 'warning',
    draft: 'secondary',
    completed: 'outline',
    archived: 'secondary',
  }
  return <Badge variant={map[status] ?? 'secondary'}>{status}</Badge>
}
