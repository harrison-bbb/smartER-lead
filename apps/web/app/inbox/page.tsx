'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { Mail, MailOpen, RefreshCw, Send, X, Sparkles } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'

type TagValue = 'interested' | 'not_interested' | 'meeting_booked' | 'out_of_office' | 'not_now' | null

interface ReplyItem {
  id: string
  fromEmail: string
  fromName?: string
  subject?: string
  bodySnippet?: string
  read: boolean
  tag: TagValue
  repliedAt?: string
  receivedAt: string
  campaignId: string
  campaignName: string
}

interface ReplyDetail extends ReplyItem {
  bodyFull?: string
}

interface InboxResponse {
  data: ReplyItem[]
  total: number
  unread: number
}

const fetcher = (url: string) => apiFetch<InboxResponse>(url)

const TAGS: { value: TagValue; label: string; color: string; dot: string }[] = [
  { value: 'interested',        label: 'Interested',        color: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200',  dot: 'bg-green-500' },
  { value: 'meeting_booked',    label: 'Meeting Booked',    color: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200',    dot: 'bg-blue-500' },
  { value: 'not_interested',    label: 'Not Interested',    color: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',        dot: 'bg-red-500' },
  { value: 'not_now',           label: 'Not Now',           color: 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200', dot: 'bg-orange-500' },
  { value: 'out_of_office',     label: 'Out of Office',     color: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200',   dot: 'bg-gray-400' },
]

function TagDot({ tag }: { tag: TagValue }) {
  if (!tag) return null
  const t = TAGS.find((t) => t.value === tag)
  if (!t) return null
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${t.dot}`} title={t.label} />
}

export default function InboxPage() {
  const [selected, setSelected] = useState<ReplyDetail | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState<TagValue>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [draftLoading, setDraftLoading] = useState(false)

  const key = `/inbox?pageSize=50${unreadOnly ? '&unread=true' : ''}${tagFilter ? `&tag=${tagFilter}` : ''}`
  const { data, isLoading } = useSWR(key, fetcher, { refreshInterval: 60_000 })
  const items = data?.data ?? []

  const openReply = async (item: ReplyItem) => {
    const res = await apiFetch<{ data: ReplyDetail }>(`/inbox/${item.id}`)
    setSelected(res.data)
    setReplyBody('')
    mutate(key)
  }

  const sendReply = async () => {
    if (!selected || !replyBody.trim()) return
    setSending(true)
    try {
      await apiFetch(`/inbox/${selected.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body: `<p>${replyBody.replace(/\n/g, '<br>')}</p>` }),
      })
      setSelected((prev) => prev ? { ...prev, repliedAt: new Date().toISOString() } : null)
      setReplyBody('')
      mutate(key)
    } finally {
      setSending(false)
    }
  }

  const setTag = async (tag: TagValue) => {
    if (!selected) return
    const newTag = selected.tag === tag ? null : tag
    await apiFetch(`/inbox/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tag: newTag }),
    })
    setSelected((prev) => prev ? { ...prev, tag: newTag } : null)
    mutate(key)
  }

  const generateDraft = async () => {
    if (!selected) return
    setDraftLoading(true)
    try {
      const res = await apiFetch<{ data: { draft: string } }>(`/inbox/${selected.id}/draft`, { method: 'POST' })
      setReplyBody(res.data.draft)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI draft failed')
    } finally {
      setDraftLoading(false)
    }
  }

  const triggerScan = async () => {
    setScanning(true)
    setScanError('')
    try {
      await apiFetch('/inbox/scan', { method: 'POST' })
      setTimeout(() => { setScanning(false); mutate(key) }, 3000)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
      setScanning(false)
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-6rem)] gap-4">
        {/* Left panel — reply list */}
        <div className="w-80 flex-shrink-0 flex flex-col border rounded-lg bg-card">
          <div className="flex items-center justify-between p-3 border-b">
            <div>
              <h1 className="font-semibold text-sm">Inbox</h1>
              {data && <p className="text-xs text-muted-foreground">{data.unread} unread</p>}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={unreadOnly ? 'default' : 'ghost'}
                className="text-xs h-7"
                onClick={() => setUnreadOnly(!unreadOnly)}
              >
                Unread
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={triggerScan} disabled={scanning} title="Scan for new replies">
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Tag filter pills */}
          <div className="flex flex-wrap gap-1 px-3 py-2 border-b">
            <button
              onClick={() => setTagFilter(null)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${tagFilter === null ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-accent'}`}
            >
              All
            </button>
            {TAGS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTagFilter(tagFilter === t.value ? null : t.value)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${tagFilter === t.value ? t.color + ' font-medium' : 'border-input hover:bg-accent'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto divide-y">
            {scanError && (
              <p className="p-3 text-xs text-destructive bg-red-50 border-b">{scanError}</p>
            )}
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
            {!isLoading && items.length === 0 && (
              <div className="p-6 text-center">
                <Mail className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No replies yet</p>
                <p className="text-xs text-muted-foreground mt-1">Replies to your campaigns will appear here</p>
              </div>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => openReply(item)}
                className={`w-full text-left p-3 hover:bg-accent transition-colors ${selected?.id === item.id ? 'bg-accent' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {item.read
                      ? <MailOpen className="h-4 w-4 text-muted-foreground" />
                      : <Mail className="h-4 w-4 text-primary" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TagDot tag={item.tag} />
                        <p className={`text-xs truncate ${item.read ? 'text-muted-foreground' : 'font-semibold'}`}>
                          {item.fromName || item.fromEmail}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatDistanceToNow(new Date(item.receivedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${item.read ? 'text-muted-foreground' : ''}`}>
                      {item.subject}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{item.bodySnippet}</p>
                    <Badge variant="secondary" className="mt-1 text-xs py-0">{item.campaignName}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel — reply detail + compose */}
        <div className="flex-1 flex flex-col border rounded-lg bg-card overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Select a reply to read it</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-4 border-b flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{selected.subject}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    From <span className="font-medium text-foreground">{selected.fromName || selected.fromEmail}</span>
                    {selected.fromName && <span className="text-xs ml-1">&lt;{selected.fromEmail}&gt;</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(selected.receivedAt).toLocaleString()} · {selected.campaignName}
                    {selected.repliedAt && <span className="ml-2 text-green-600">· Replied</span>}
                  </p>
                  {/* Intent tags */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {TAGS.map((t) => {
                      const active = selected.tag === t.value
                      return (
                        <button
                          key={t.value}
                          onClick={() => setTag(t.value)}
                          className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${active ? t.color : 'border-input text-muted-foreground hover:bg-accent'}`}
                        >
                          {active ? '✓ ' : ''}{t.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-4">
                {selected.bodyFull ? (
                  <div
                    className="prose prose-sm max-w-none text-sm"
                    dangerouslySetInnerHTML={{ __html: selected.bodyFull }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{selected.bodySnippet}</p>
                )}
              </div>

              {/* Reply composer */}
              <div className="border-t p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    Reply to {selected.fromName || selected.fromEmail}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 gap-1"
                    onClick={generateDraft}
                    disabled={draftLoading}
                  >
                    <Sparkles className="h-3 w-3" />
                    {draftLoading ? 'Drafting...' : 'Draft with AI'}
                  </Button>
                </div>
                <textarea
                  rows={4}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply..."
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
                <div className="flex justify-end">
                  <Button onClick={sendReply} disabled={sending || !replyBody.trim()} size="sm">
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    {sending ? 'Sending...' : 'Send Reply'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
