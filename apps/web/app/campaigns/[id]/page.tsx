'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import { formatPercent } from '@/lib/utils'

interface CampaignDetail {
  id: string
  name: string
  status: string
  dailyLimit: number
  trackOpens: boolean
  trackClicks: boolean
  steps: Array<{ id: string; stepNumber: number; subject: string; delayDays: number }>
}

interface Stats {
  totalLeads: number
  sent: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
}

interface SendRow {
  id: string
  sentAt: string
  leadEmail: string
  firstName: string | null
  lastName: string | null
  company: string | null
  stepNumber: number
  subject: string
  status: 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed'
}

interface SendsResponse {
  data: SendRow[]
  total: number
  page: number
  pages: number
}

const fetcher = (url: string) => apiFetch<{ data: unknown }>(url)
const sendsFetcher = (url: string) => apiFetch<SendsResponse>(url)

const STATUS_STYLES: Record<string, string> = {
  sent: 'bg-muted text-muted-foreground',
  opened: 'bg-blue-100 text-blue-700',
  clicked: 'bg-purple-100 text-purple-700',
  replied: 'bg-green-100 text-green-700',
  bounced: 'bg-red-100 text-red-700',
  unsubscribed: 'bg-orange-100 text-orange-700',
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'overview' | 'log'>('overview')
  const [logPage, setLogPage] = useState(1)
  const [warmupWarning, setWarmupWarning] = useState<string | null>(null)

  const { data: campaignData } = useSWR(`/campaigns/${id}`, fetcher)
  const { data: statsData } = useSWR(`/campaigns/${id}/analytics`, fetcher)
  const { data: sendsData } = useSWR(
    tab === 'log' ? `/campaigns/${id}/sends?page=${logPage}&limit=50` : null,
    sendsFetcher,
    { refreshInterval: 30_000 },
  )

  const campaign = campaignData?.data as CampaignDetail | undefined
  const stats = statsData?.data as Stats | undefined
  const sends = sendsData?.data ?? []
  const sendTotal = sendsData?.total ?? 0
  const sendPages = sendsData?.pages ?? 1

  const handleStart = async () => {
    const result = await apiFetch<{ data: unknown; warning?: string }>(`/campaigns/${id}/start`, { method: 'POST' })
    if (result.warning) setWarmupWarning(result.warning)
    mutate(`/campaigns/${id}`)
    mutate(`/campaigns/${id}/analytics`)
  }

  const handlePause = async () => {
    await apiFetch(`/campaigns/${id}/pause`, { method: 'POST' })
    mutate(`/campaigns/${id}`)
  }

  const chartData = stats
    ? [
        { name: 'Sent', value: stats.sent },
        { name: 'Opened', value: stats.opened },
        { name: 'Clicked', value: stats.clicked },
        { name: 'Replied', value: stats.replied },
        { name: 'Bounced', value: stats.bounced },
      ]
    : []

  if (!campaign) return <AppShell><p className="text-muted-foreground">Loading...</p></AppShell>

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Link href="/campaigns">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="text-muted-foreground text-sm">{campaign.dailyLimit} emails/day · {campaign.steps.length} steps</p>
          </div>
          <div className="flex gap-2">
            {campaign.status === 'draft' || campaign.status === 'paused' ? (
              <Button onClick={handleStart} size="sm">
                <Play className="h-3 w-3 mr-1" /> Start
              </Button>
            ) : campaign.status === 'active' ? (
              <Button onClick={handlePause} size="sm" variant="outline">
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
            ) : null}
          </div>
        </div>

        {warmupWarning && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
            <span className="flex-1">{warmupWarning}</span>
            <button onClick={() => setWarmupWarning(null)} className="text-yellow-600 hover:text-yellow-900 text-xs underline flex-shrink-0">dismiss</button>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Sent" value={stats?.sent ?? 0} />
          <StatCard label="Open rate" value={formatPercent(stats?.openRate ?? 0)} highlight={!!stats?.openRate} />
          <StatCard label="Click rate" value={formatPercent(stats?.clickRate ?? 0)} />
          <StatCard label="Reply rate" value={formatPercent(stats?.replyRate ?? 0)} highlight={!!stats?.replyRate} />
        </div>

        {/* Tabs */}
        <div className="flex border-b gap-6">
          <button
            onClick={() => setTab('overview')}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'overview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setTab('log')}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'log' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Sending Log {sendTotal > 0 && tab === 'log' ? `(${sendTotal})` : ''}
          </button>
        </div>

        {tab === 'overview' && (
          <>
            {/* Chart */}
            {stats && stats.sent > 0 && (
              <Card>
                <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Sequence steps */}
            <Card>
              <CardHeader><CardTitle>Sequence ({campaign.steps.length} steps)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {campaign.steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-3 p-3 rounded-lg border">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {step.stepNumber}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{step.subject}</p>
                      {step.stepNumber > 1 && (
                        <p className="text-xs text-muted-foreground">Sends {step.delayDays} day{step.delayDays !== 1 ? 's' : ''} after previous step</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        {tab === 'log' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Sending Log</CardTitle>
                {sendTotal > 0 && (
                  <span className="text-sm text-muted-foreground">{sendTotal} emails sent · refreshes every 30s</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sends.length === 0 ? (
                <p className="text-muted-foreground text-sm p-6">No emails sent yet.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Lead</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Step</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Subject</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sends.map((row) => (
                          <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                              {formatTime(row.sentAt)}
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{row.firstName ? `${row.firstName} ${row.lastName ?? ''}`.trim() : row.leadEmail}</p>
                              {row.firstName && <p className="text-xs text-muted-foreground">{row.leadEmail}</p>}
                              {row.company && <p className="text-xs text-muted-foreground">{row.company}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              Step {row.stepNumber}
                            </td>
                            <td className="px-4 py-2.5 max-w-[220px] truncate text-muted-foreground">
                              {row.subject}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {sendPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t">
                      <span className="text-xs text-muted-foreground">Page {logPage} of {sendPages}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={logPage <= 1}
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={logPage >= sendPages}
                          onClick={() => setLogPage((p) => Math.min(sendPages, p + 1))}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-green-600' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'outline'> = {
    active: 'success', paused: 'warning', draft: 'secondary', completed: 'outline', archived: 'secondary',
  }
  return <Badge variant={map[status] ?? 'secondary'}>{status}</Badge>
}
