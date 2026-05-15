'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Plus, Trash2, Edit2, X, Check } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

interface Template {
  id: string
  name: string
  subject: string
  body: string
  createdAt: string
}

const fetcher = (url: string) => apiFetch<{ data: Template[] }>(url)

export default function TemplatesPage() {
  const { data, isLoading } = useSWR('/templates', fetcher)
  const templates = data?.data ?? []

  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form, setForm] = useState({ name: '', subject: '', body: '' })
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', subject: '', body: '' })
    setShowNew(true)
  }

  const openEdit = (t: Template) => {
    setEditing(t)
    setForm({ name: t.name, subject: t.subject, body: t.body })
    setShowNew(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.subject || !form.body) return
    setSaving(true)
    try {
      if (editing) {
        await apiFetch(`/templates/${editing.id}`, { method: 'PATCH', body: JSON.stringify(form) })
      } else {
        await apiFetch('/templates', { method: 'POST', body: JSON.stringify(form) })
      }
      setShowNew(false)
      mutate('/templates')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/templates/${id}`, { method: 'DELETE' })
    mutate('/templates')
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Templates</h1>
            <p className="text-muted-foreground">Reusable email subjects and bodies for your campaigns</p>
          </div>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>

        {showNew && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{editing ? 'Edit Template' : 'New Template'}</CardTitle>
                <Button size="icon" variant="ghost" onClick={() => setShowNew(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Template name</Label>
                <Input
                  placeholder="e.g. Cold Intro — SaaS"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Subject line</Label>
                <Input
                  placeholder="e.g. Quick question, {{firstName}}"
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Body (HTML supported)</Label>
                <textarea
                  rows={8}
                  placeholder="Hi {{firstName}},&#10;&#10;I noticed that {{company}}..."
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
                />
                <p className="text-xs text-muted-foreground">Variables: {'{{firstName}}'} {'{{lastName}}'} {'{{company}}'} {'{{title}}'}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving || !form.name || !form.subject || !form.body}>
                  <Check className="h-4 w-4 mr-1" />
                  {saving ? 'Saving...' : 'Save Template'}
                </Button>
                <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading && <p className="text-muted-foreground">Loading...</p>}

        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Subject: {t.subject}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 font-mono">
                      {t.body.replace(/<[^>]+>/g, '').slice(0, 120)}...
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {templates.length === 0 && !isLoading && !showNew && (
            <div className="text-center py-12 border rounded-lg bg-card">
              <p className="text-muted-foreground">No templates yet.</p>
              <Button variant="link" onClick={openNew}>Create your first template</Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
