'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Plus, Trash2, ShieldX } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'

interface BlocklistEntry { id: string; value: string; type: 'email' | 'domain'; createdAt: string }
const fetcher = (url: string) => apiFetch<{ data: BlocklistEntry[] }>(url)

export default function SettingsPage() {
  const { data, isLoading } = useSWR('/blocklist', fetcher)
  const entries = data?.data ?? []

  const [value, setValue] = useState('')
  const [type, setType] = useState<'email' | 'domain'>('email')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async () => {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return
    setAdding(true)
    setError('')
    try {
      await apiFetch('/blocklist', { method: 'POST', body: JSON.stringify({ value: trimmed, type }) })
      setValue('')
      mutate('/blocklist')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/blocklist/${id}`, { method: 'DELETE' })
    mutate('/blocklist')
  }

  return (
    <AppShell>
      <div className="space-y-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage global preferences and compliance settings</p>
        </div>

        {/* Blocklist */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-destructive" />
              <div>
                <CardTitle>Global Blocklist</CardTitle>
                <CardDescription className="mt-0.5">
                  Emails or domains on this list will never be contacted, across all campaigns.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add form */}
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label>Email or domain</Label>
                <Input
                  placeholder={type === 'email' ? 'spam@example.com' : 'competitor.com'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'email' | 'domain')}
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="email">Email</option>
                  <option value="domain">Domain</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="invisible">Add</Label>
                <Button onClick={handleAdd} disabled={adding || !value.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* List */}
            {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            <div className="divide-y border rounded-lg">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Badge variant={entry.type === 'domain' ? 'secondary' : 'outline'} className="text-xs">
                    {entry.type}
                  </Badge>
                  <span className="flex-1 text-sm font-mono">{entry.value}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(entry.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {entries.length === 0 && !isLoading && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No blocked emails or domains yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
