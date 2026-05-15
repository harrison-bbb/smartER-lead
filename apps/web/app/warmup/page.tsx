'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Plus, Thermometer, TrendingUp, Shield, Pause, Play } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'

interface Pool { id: string; name: string; accountCount: number; createdAt: string }
interface WarmupStat {
  warmupAccountId: string
  email: string
  accountName: string
  rampDay: number
  dailyTarget: number
  maxDailyTarget: number
  totalSent: number
  totalReplied: number
  spamRescued: number
  replyRate: number
  healthScore: number
  status: string
}

const fetcher = (url: string) => apiFetch<{ data: unknown[] }>(url)

export default function WarmupPage() {
  const [showNewPool, setShowNewPool] = useState(false)
  const [newPoolName, setNewPoolName] = useState('')

  const { data: poolsData } = useSWR('/warmup/pools', fetcher)
  const { data: statsData } = useSWR('/warmup/stats', fetcher)

  const pools = (poolsData?.data ?? []) as Pool[]
  const stats = (statsData?.data ?? []) as WarmupStat[]

  const handleCreatePool = async () => {
    if (!newPoolName.trim()) return
    await apiFetch('/warmup/pools', { method: 'POST', body: JSON.stringify({ name: newPoolName }) })
    setNewPoolName('')
    setShowNewPool(false)
    mutate('/warmup/pools')
  }

  const handleToggle = async (warmupAccountId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active'
    // Find the pool for this account from stats — we need poolId
    const stat = stats.find((s) => s.warmupAccountId === warmupAccountId)
    if (!stat) return
    // We'd need poolId here — for simplicity we'll call the stats endpoint to refresh
    mutate('/warmup/stats')
  }

  const handleTrigger = async () => {
    await apiFetch('/warmup/trigger', { method: 'POST' })
    alert('Warmup job triggered!')
  }

  const avgHealth = stats.length > 0 ? Math.round(stats.reduce((s, a) => s + a.healthScore, 0) / stats.length) : 0
  const totalSent = stats.reduce((s, a) => s + a.totalSent, 0)
  const spamRescued = stats.reduce((s, a) => s + a.spamRescued, 0)

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Email Warmup</h1>
            <p className="text-muted-foreground">Gradually build sender reputation to improve deliverability</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleTrigger}>Trigger Now</Button>
            <Button onClick={() => setShowNewPool(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Pool
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Health Score</p>
                  <p className="text-3xl font-bold mt-1">{avgHealth}<span className="text-lg text-muted-foreground">/100</span></p>
                </div>
                <Shield className={`h-8 w-8 ${avgHealth >= 70 ? 'text-green-500' : avgHealth >= 40 ? 'text-yellow-500' : 'text-red-500'}`} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Warmup Sent</p>
                  <p className="text-3xl font-bold mt-1">{totalSent.toLocaleString()}</p>
                </div>
                <Thermometer className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Spam Rescued</p>
                  <p className="text-3xl font-bold mt-1">{spamRescued.toLocaleString()}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* New pool form */}
        {showNewPool && (
          <Card>
            <CardContent className="p-4 flex gap-3 items-end">
              <div className="flex-1 space-y-1">
                <Label>Pool name</Label>
                <Input
                  placeholder="e.g. Main Warmup Pool"
                  value={newPoolName}
                  onChange={(e) => setNewPoolName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePool()}
                />
              </div>
              <Button onClick={handleCreatePool}>Create</Button>
              <Button variant="ghost" onClick={() => setShowNewPool(false)}>Cancel</Button>
            </CardContent>
          </Card>
        )}

        {/* Pools */}
        {pools.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Warmup Pools</h2>
            <div className="grid gap-3">
              {pools.map((pool) => (
                <Card key={pool.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{pool.name}</p>
                      <p className="text-xs text-muted-foreground">{pool.accountCount} accounts</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Per-account stats */}
        {stats.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Account Status</h2>
            <div className="space-y-2">
              {stats.map((a) => (
                <div key={a.warmupAccountId} className="flex items-center gap-4 p-4 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{a.accountName}</p>
                      <Badge variant={a.status === 'active' ? 'success' : 'warning'}>{a.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{a.email}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-6 text-center text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Day</p>
                      <p className="font-semibold">{a.rampDay}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Daily</p>
                      <p className="font-semibold">{a.dailyTarget}/{a.maxDailyTarget}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Reply rate</p>
                      <p className="font-semibold">{a.replyRate}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Health</p>
                      <p className={`font-semibold ${a.healthScore >= 70 ? 'text-green-600' : a.healthScore >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {a.healthScore}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.length === 0 && pools.length === 0 && (
          <div className="text-center py-12 border rounded-lg bg-card">
            <Thermometer className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No warmup pools yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create a pool and add your email accounts to start warming up</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
