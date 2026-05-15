'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import useSWR from 'swr'
import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

const stepSchema = z.object({
  subject: z.string().min(1, 'Subject required'),
  body: z.string().min(1, 'Body required'),
  delayDays: z.coerce.number().int().min(0).default(0),
  stepNumber: z.number().int().default(1),
})

const schema = z.object({
  name: z.string().min(1, 'Campaign name required'),
  emailAccountId: z.string().min(1, 'Select an email account'),
  listId: z.string().optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500).default(50),
  sendingStartHour: z.coerce.number().int().min(0).max(23).default(8),
  sendingEndHour: z.coerce.number().int().min(0).max(23).default(18),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(true),
  timezone: z.string().default('America/New_York'),
  steps: z.array(stepSchema).min(1, 'Add at least one sequence step'),
})

type FormData = z.infer<typeof schema>

interface Account { id: string; name: string; email: string }
interface List { id: string; name: string; leadCount: number }

const fetcher = (url: string) => apiFetch<{ data: unknown[] }>(url)

export default function NewCampaignPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const { data: accountsData } = useSWR('/accounts', fetcher)
  const { data: listsData } = useSWR('/lists', fetcher)
  const accounts = (accountsData?.data ?? []) as Account[]
  const lists = (listsData?.data ?? []) as List[]

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      dailyLimit: 50,
      sendingStartHour: 8,
      sendingEndHour: 18,
      trackOpens: true,
      trackClicks: true,
      timezone: 'America/New_York',
      steps: [{ subject: '', body: '', delayDays: 0, stepNumber: 1 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'steps' })

  const onSubmit = async (data: FormData) => {
    setError('')
    try {
      const res = await apiFetch<{ data: { id: string } }>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          emailAccountId: data.emailAccountId,
          listId: data.listId || undefined,
          dailyLimit: data.dailyLimit,
          sendingStartHour: data.sendingStartHour,
          sendingEndHour: data.sendingEndHour,
          trackOpens: data.trackOpens,
          trackClicks: data.trackClicks,
          timezone: data.timezone,
        }),
      })
      const campaignId = res.data.id

      await apiFetch(`/campaigns/${campaignId}/steps`, {
        method: 'PUT',
        body: JSON.stringify({
          steps: data.steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
        }),
      })

      router.push(`/campaigns/${campaignId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
    }
  }

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/campaigns">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">New Campaign</h1>
            <p className="text-muted-foreground">Set up your email sequence</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* General settings */}
          <Card>
            <CardHeader><CardTitle>Campaign Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Campaign name</Label>
                <Input placeholder="e.g. Q2 Outreach — SaaS founders" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Sending account</Label>
                  <select
                    {...register('emailAccountId')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select account...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                    ))}
                  </select>
                  {errors.emailAccountId && <p className="text-xs text-destructive">{errors.emailAccountId.message}</p>}
                </div>

                <div className="space-y-1">
                  <Label>Lead list (optional)</Label>
                  <select
                    {...register('listId')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select list...</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.leadCount} leads)</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Daily limit</Label>
                  <Input type="number" {...register('dailyLimit')} />
                </div>
                <div className="space-y-1">
                  <Label>Start hour (0–23)</Label>
                  <Input type="number" {...register('sendingStartHour')} />
                </div>
                <div className="space-y-1">
                  <Label>End hour (0–23)</Label>
                  <Input type="number" {...register('sendingEndHour')} />
                </div>
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('trackOpens')} />
                  Track opens
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('trackClicks')} />
                  Track clicks
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Sequence steps */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Email Sequence</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ subject: '', body: '', delayDays: fields.length === 0 ? 0 : 3, stepNumber: fields.length + 1 })
                  }
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add step
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {errors.steps?.root && <p className="text-xs text-destructive">{errors.steps.root.message}</p>}
              {fields.map((field, idx) => (
                <div key={field.id} className="border rounded-lg p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      Step {idx + 1}
                      {idx > 0 && (
                        <span className="text-muted-foreground font-normal ml-2">
                          — send after{' '}
                          <input
                            type="number"
                            className="w-12 inline-block border rounded px-1 text-center text-sm"
                            {...register(`steps.${idx}.delayDays`)}
                          />{' '}
                          days
                        </span>
                      )}
                    </p>
                    {fields.length > 1 && (
                      <Button type="button" size="icon" variant="ghost" onClick={() => remove(idx)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Subject</Label>
                    <Input
                      placeholder="e.g. {{firstName}}, quick question"
                      {...register(`steps.${idx}.subject`)}
                    />
                    {errors.steps?.[idx]?.subject && (
                      <p className="text-xs text-destructive">{errors.steps[idx]?.subject?.message}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Body (HTML supported)</Label>
                    <textarea
                      rows={6}
                      placeholder="Hi {{firstName}},&#10;&#10;I noticed that..."
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
                      {...register(`steps.${idx}.body`)}
                    />
                    {errors.steps?.[idx]?.body && (
                      <p className="text-xs text-destructive">{errors.steps[idx]?.body?.message}</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Variables: {'{{firstName}}'} {'{{lastName}}'} {'{{company}}'} {'{{title}}'} {'{{email}}'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Creating...' : 'Create Campaign'}
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
