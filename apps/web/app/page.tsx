'use client'

import useSWR from 'swr'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { Mail, Users, TrendingUp, CheckCircle } from 'lucide-react'

interface Campaign {
  id: string
  name: string
  status: string
  totalLeads: number
}

function fetcher(url: string) {
  return apiFetch(url)
}

export default function DashboardPage() {
  const { data: campaigns } = useSWR<{ data: Campaign[] }>('/campaigns', fetcher)

  const active = campaigns?.data.filter((c) => c.status === 'active').length ?? 0
  const total = campaigns?.data.length ?? 0
  const totalLeads = campaigns?.data.reduce((s, c) => s + (c.totalLeads ?? 0), 0) ?? 0

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your outreach activity</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Campaigns" value={total} icon={Mail} />
          <StatCard title="Active Campaigns" value={active} icon={TrendingUp} color="text-green-600" />
          <StatCard title="Total Leads" value={totalLeads} icon={Users} />
          <StatCard title="Completed" value={campaigns?.data.filter((c) => c.status === 'completed').length ?? 0} icon={CheckCircle} color="text-blue-600" />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Recent Campaigns</h2>
          {campaigns?.data.length === 0 && (
            <p className="text-muted-foreground text-sm">No campaigns yet. <a href="/campaigns/new" className="text-primary hover:underline">Create your first campaign</a></p>
          )}
          <div className="space-y-2">
            {campaigns?.data.slice(0, 5).map((c) => (
              <a
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.totalLeads} leads</p>
                </div>
                <StatusBadge status={c.status} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function StatCard({ title, value, icon: Icon, color = 'text-primary' }: { title: string; value: number; icon: React.ElementType; color?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <Icon className={`h-8 w-8 ${color} opacity-80`} />
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    draft: 'bg-gray-100 text-gray-600',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}
