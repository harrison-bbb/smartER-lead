'use client'

import { useState, useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import { useSearchParams } from 'next/navigation'
import { Plus, CheckCircle, AlertCircle, Clock, Trash2, RefreshCw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

interface WarmupStatus {
  inPool: boolean
  rampDay: number | null
  dailyTarget: number | null
  healthScore: number | null
  recommendedDailyLimit: number
}

interface Account {
  id: string
  name: string
  senderName?: string
  email: string
  provider: string
  status: string
  dailySendLimit: number
  sentTodayCount: number
  lastError?: string
  warmupStatus: WarmupStatus
}

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  provider: z.enum(['smtp', 'gmail', 'outlook']),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().optional(),
  smtpSecure: z.boolean().default(true),
  imapHost: z.string().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  dailySendLimit: z.coerce.number().int().min(1).max(500).default(50),
})

type FormData = z.infer<typeof schema>

const fetcher = (url: string) => apiFetch<{ data: Account[] }>(url)

export default function AccountsPage() {
  const [showForm, setShowForm] = useState(false)
  const [banner, setBanner] = useState('')
  const searchParams = useSearchParams()
  const { data, isLoading } = useSWR('/accounts', fetcher)
  const accounts = data?.data ?? []

  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (connected === 'gmail') {
      setBanner('Gmail account connected successfully!')
      mutate('/accounts')
    } else if (error === 'no_refresh_token') {
      setBanner('Could not get refresh token. Go to myaccount.google.com/permissions, revoke "Outreach", then try again.')
    } else if (error) {
      setBanner(`Google connection failed: ${error}`)
    }
  }, [searchParams])

  const handleConnectGmail = () => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    const name = prompt('Name this account (e.g. "Harrison — Sales")', 'Gmail Account')
    if (!name) return
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    window.location.href = `${apiUrl}/auth/google/start?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`
  }

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { provider: 'smtp', smtpSecure: true, dailySendLimit: 50 },
  })

  const provider = watch('provider')

  const onSubmit = async (data: FormData) => {
    await apiFetch('/accounts', { method: 'POST', body: JSON.stringify(data) })
    reset()
    setShowForm(false)
    mutate('/accounts')
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/accounts/${id}`, { method: 'DELETE' })
    mutate('/accounts')
  }

  const handleSyncLimit = async (id: string, recommendedDailyLimit: number) => {
    await apiFetch(`/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ dailySendLimit: recommendedDailyLimit }),
    })
    mutate('/accounts')
  }

  const handleTest = async (id: string) => {
    try {
      await apiFetch(`/accounts/${id}/test`, { method: 'POST' })
      mutate('/accounts')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Test failed')
      mutate('/accounts')
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Email Accounts</h1>
            <p className="text-muted-foreground">Connect your SMTP or Gmail accounts for sending</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleConnectGmail} variant="outline">
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Connect Gmail
            </Button>
            <Button onClick={() => setShowForm(!showForm)} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add SMTP
            </Button>
          </div>
        </div>

        {banner && (
          <div className={`p-3 rounded-lg text-sm ${banner.includes('success') ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {banner}
            <button className="ml-2 underline text-xs" onClick={() => setBanner('')}>dismiss</button>
          </div>
        )}

        {showForm && (
          <Card>
            <CardHeader><CardTitle>Add Email Account</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Account name</Label>
                    <Input placeholder="e.g. Sales Inbox" {...register('name')} />
                    {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>Provider</Label>
                    <select
                      {...register('provider')}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="smtp">Custom SMTP</option>
                      <option value="gmail">Gmail</option>
                      <option value="outlook">Outlook</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>From email</Label>
                  <Input type="email" placeholder="you@yourcompany.com" {...register('email')} />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>

                {provider === 'smtp' && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-1">
                      <Label>SMTP Host</Label>
                      <Input placeholder="smtp.yourprovider.com" {...register('smtpHost')} />
                    </div>
                    <div className="space-y-1">
                      <Label>Port</Label>
                      <Input type="number" placeholder="587" {...register('smtpPort')} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label>IMAP Host (for reply detection)</Label>
                      <Input placeholder="imap.yourprovider.com" {...register('imapHost')} />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Username / Email</Label>
                    <Input placeholder="your@email.com" {...register('username')} />
                    {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>Password / App Password</Label>
                    <Input type="password" placeholder="••••••••" {...register('password')} />
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                  </div>
                </div>

                <div className="space-y-1 w-40">
                  <Label>Daily send limit</Label>
                  <Input type="number" {...register('dailySendLimit')} />
                </div>

                <div className="flex gap-3">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Adding...' : 'Add Account'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {isLoading && <p className="text-muted-foreground">Loading...</p>}

        <div className="space-y-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onTest={handleTest}
              onDelete={handleDelete}
              onSaved={() => mutate('/accounts')}
              onSyncLimit={handleSyncLimit}
            />
          ))}

          {accounts.length === 0 && !isLoading && (
            <div className="text-center py-12 border rounded-lg bg-card">
              <p className="text-muted-foreground">No accounts yet. Add a Gmail or SMTP account to start sending.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function AccountCard({
  account,
  onTest,
  onDelete,
  onSaved,
  onSyncLimit,
}: {
  account: Account
  onTest: (id: string) => void
  onDelete: (id: string) => void
  onSaved: () => void
  onSyncLimit: (id: string, limit: number) => void
}) {
  const [editingSenderName, setEditingSenderName] = useState(false)
  const [senderName, setSenderName] = useState(account.senderName ?? '')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const saveSenderName = async () => {
    setSaving(true)
    await apiFetch(`/accounts/${account.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ senderName }),
    })
    setSaving(false)
    setEditingSenderName(false)
    onSaved()
  }

  const handleSync = async () => {
    setSyncing(true)
    await onSyncLimit(account.id, account.warmupStatus.recommendedDailyLimit)
    setSyncing(false)
  }

  const ws = account.warmupStatus
  const healthColor = !ws.inPool ? 'text-muted-foreground' : ws.healthScore! >= 70 ? 'text-green-600' : ws.healthScore! >= 40 ? 'text-yellow-600' : 'text-red-600'
  const healthDot = !ws.inPool ? '○' : ws.healthScore! >= 70 ? '●' : ws.healthScore! >= 40 ? '●' : '●'
  const alreadySynced = ws.inPool && account.dailySendLimit === ws.recommendedDailyLimit

  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-4">
        <StatusIcon status={account.status} />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{account.name}</p>
            <span className="text-xs text-muted-foreground capitalize">{account.provider}</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">{account.email}</p>

          {/* Sender name */}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs text-muted-foreground">Sends as:</span>
            {editingSenderName ? (
              <>
                <input
                  autoFocus
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveSenderName(); if (e.key === 'Escape') setEditingSenderName(false) }}
                  placeholder="Your Name"
                  className="h-6 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring w-40"
                />
                <button
                  onClick={saveSenderName}
                  disabled={saving}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingSenderName(false)} className="text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditingSenderName(true)}
                className="text-xs font-medium hover:underline"
              >
                {senderName || <span className="text-destructive">Not set — click to fix</span>}
              </button>
            )}
          </div>

          {/* Warmup health */}
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            <span className={`text-xs font-medium ${healthColor}`}>
              {healthDot} {ws.inPool
                ? `${ws.healthScore! >= 70 ? 'Warmed up' : ws.healthScore! >= 40 ? 'Warming' : 'Cold'} · Day ${ws.rampDay} · Health ${ws.healthScore}/100 · Recommended: ${ws.recommendedDailyLimit}/day`
                : 'No warmup — add to a pool at /warmup'}
            </span>
            {ws.inPool && !alreadySynced && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : `Sync limit to ${ws.recommendedDailyLimit}`}
              </button>
            )}
            {ws.inPool && alreadySynced && (
              <span className="text-xs text-muted-foreground">Limit synced</span>
            )}
          </div>

          {account.lastError && (
            <p className="text-xs text-destructive truncate">{account.lastError}</p>
          )}
        </div>
        <div className="text-right text-sm flex-shrink-0">
          <p className="font-medium">{account.sentTodayCount}/{account.dailySendLimit}</p>
          <p className="text-xs text-muted-foreground">sent today</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button size="icon" variant="ghost" onClick={() => onTest(account.id)} title="Test connection">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => onDelete(account.id)}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'active') return <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
  if (status === 'error') return <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
  return <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
}
