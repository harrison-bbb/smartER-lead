'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Link from 'next/link'
import { Plus, Upload, Trash2, Search, X, ListPlus, Check, AlertTriangle } from 'lucide-react'
import { useConfirm } from '@/lib/use-confirm'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'

interface List { id: string; name: string; leadCount: number }

interface Lead {
  id: string
  email: string
  firstName?: string
  lastName?: string
  company?: string
  title?: string
  status: string
  createdAt: string
}

const schema = z.object({
  email: z.string().email('Valid email required'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const fetcher = (url: string) => apiFetch<{ data: Lead[]; total: number }>(url)

export default function LeadsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState('')
  const [addingToList, setAddingToList] = useState<string | null>(null)
  const { confirm, cancel, isPending } = useConfirm() // leadId being acted on
  const [addedToLists, setAddedToLists] = useState<Record<string, string[]>>({}) // leadId → listIds added

  const key = `/leads?page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`
  const { data, isLoading } = useSWR(key, fetcher)
  const { data: listsData } = useSWR('/lists', (url: string) => apiFetch<{ data: List[] }>(url))
  const leads = data?.data ?? []
  const total = data?.total ?? 0

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (formData: FormData) => {
    setFormError('')
    try {
      await apiFetch('/leads', { method: 'POST', body: JSON.stringify(formData) })
      reset()
      setShowForm(false)
      mutate(key)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add lead')
    }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/leads/${id}`, { method: 'DELETE' })
    cancel()
    mutate(key)
  }

  const lists = listsData?.data ?? []

  const handleAddToList = async (leadId: string, listId: string) => {
    await apiFetch(`/lists/${listId}/leads`, {
      method: 'POST',
      body: JSON.stringify({ leadIds: [leadId] }),
    })
    setAddedToLists((prev) => ({
      ...prev,
      [leadId]: [...(prev[leadId] ?? []), listId],
    }))
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Leads</h1>
            <p className="text-muted-foreground">{total} total leads</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setShowForm(!showForm); setFormError('') }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Lead
            </Button>
            <Link href="/leads/import">
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </Button>
            </Link>
          </div>
        </div>

        {/* Inline add-lead form */}
        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Add Lead</CardTitle>
                <Button size="icon" variant="ghost" onClick={() => setShowForm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Email <span className="text-destructive">*</span></Label>
                    <Input placeholder="harrison@example.com" {...register('email')} />
                    {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>First name</Label>
                    <Input placeholder="Harrison" {...register('firstName')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Last name</Label>
                    <Input placeholder="Smith" {...register('lastName')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Company</Label>
                    <Input placeholder="Blackbox Bots" {...register('company')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Job title</Label>
                    <Input placeholder="CEO" {...register('title')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Phone</Label>
                    <Input placeholder="+1 555 000 0000" {...register('phone')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Website</Label>
                    <Input placeholder="https://blackboxbots.com" {...register('website')} />
                  </div>
                </div>

                {formError && <p className="text-sm text-destructive">{formError}</p>}

                <div className="flex gap-2 pt-1">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Adding...' : 'Add Lead'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setShowForm(false); reset() }}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              className="pl-8"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading...</p>}

        <div className="border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{lead.email}</td>
                  <td className="px-4 py-3">{[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.company ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.title ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  {/* Add to list dropdown */}
                  <td className="px-4 py-3 relative">
                    {lists.length > 0 && (
                      <div className="relative">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Add to list"
                          onClick={() => setAddingToList(addingToList === lead.id ? null : lead.id)}
                        >
                          <ListPlus className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        {addingToList === lead.id && (
                          <>
                            {/* backdrop to close */}
                            <div className="fixed inset-0 z-10" onClick={() => setAddingToList(null)} />
                            <div className="absolute right-0 top-8 z-20 w-52 rounded-lg border bg-card shadow-lg py-1" style={{ minWidth: '13rem' }}>
                              <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Add to list</p>
                              {lists.map((list) => {
                                const already = addedToLists[lead.id]?.includes(list.id)
                                return (
                                  <button
                                    key={list.id}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                                    onClick={async () => {
                                      if (!already) await handleAddToList(lead.id, list.id)
                                      setAddingToList(null)
                                    }}
                                  >
                                    {already
                                      ? <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                      : <div className="h-3.5 w-3.5 flex-shrink-0" />
                                    }
                                    <span className="truncate">{list.name}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isPending(lead.id) ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => handleDelete(lead.id)}>
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={cancel}>
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" onClick={() => confirm(lead.id)}>
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No leads yet.{' '}
                    <button className="text-primary hover:underline" onClick={() => setShowForm(true)}>
                      Add one manually
                    </button>
                    {' or '}
                    <Link href="/leads/import" className="text-primary hover:underline">
                      import a CSV
                    </Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 50 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground py-2">Page {page}</span>
            <Button variant="outline" size="sm" disabled={leads.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive'> = {
    active: 'secondary',
    replied: 'success',
    bounced: 'destructive',
    unsubscribed: 'warning',
  }
  return <Badge variant={map[status] ?? 'secondary'}>{status}</Badge>
}
