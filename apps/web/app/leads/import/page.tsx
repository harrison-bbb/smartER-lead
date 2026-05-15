'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Upload, ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

const LEAD_FIELDS = [
  { value: '', label: '— Skip —' },
  { value: 'email', label: 'Email (required)' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'company', label: 'Company' },
  { value: 'title', label: 'Job Title' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
]

interface List { id: string; name: string }
const fetcher = (url: string) => apiFetch<{ data: List[] }>(url)

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'map' | 'done'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [listId, setListId] = useState('')
  const [result, setResult] = useState<{ imported: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: listsData } = useSWR('/lists', fetcher)
  const lists = listsData?.data ?? []

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError('')

    const formData = new FormData()
    formData.append('file', f)
    try {
      const res = await apiFetch<{ data: { headers: string[]; preview: Record<string, string>[] } }>(
        '/leads/import/preview',
        { method: 'POST', body: formData },
      )
      setHeaders(res.data.headers)
      setPreview(res.data.preview)
      // Auto-map common headers
      const autoMap: Record<string, string> = {}
      for (const h of res.data.headers) {
        const lower = h.toLowerCase()
        if (lower.includes('email')) autoMap[h] = 'email'
        else if (lower.includes('first')) autoMap[h] = 'firstName'
        else if (lower.includes('last')) autoMap[h] = 'lastName'
        else if (lower.includes('company') || lower.includes('org')) autoMap[h] = 'company'
        else if (lower.includes('title') || lower.includes('role')) autoMap[h] = 'title'
      }
      setMapping(autoMap)
      setStep('map')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
    }
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mapping', JSON.stringify(mapping))
      if (listId) formData.append('listId', listId)

      const res = await apiFetch<{ data: { imported: number; total: number } }>(
        '/leads/import',
        { method: 'POST', body: formData },
      )
      setResult(res.data)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/leads">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Import Leads</h1>
            <p className="text-muted-foreground">Upload a CSV file to import contacts</p>
          </div>
        </div>

        {step === 'upload' && (
          <Card>
            <CardContent className="p-8">
              <div
                className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">Click to upload a CSV file</p>
                <p className="text-sm text-muted-foreground mt-1">Max 10 MB · CSV format</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </div>
              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
            </CardContent>
          </Card>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Map Columns</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {headers.map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <div className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded">{header}</div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <select
                      value={mapping[header] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                      className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {LEAD_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </CardContent>
            </Card>

            {preview.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Preview (first {preview.length} rows)</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>{headers.map((h) => <th key={h} className="px-2 py-1 text-left text-muted-foreground">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i}>
                            {headers.map((h) => <td key={h} className="px-2 py-1 border-t">{row[h]}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4">
                <Label>Add to list (optional)</Label>
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="flex mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">No list</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </CardContent>
            </Card>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleImport} disabled={loading} className="w-full">
              {loading ? 'Importing...' : 'Import Leads'}
            </Button>
          </div>
        )}

        {step === 'done' && result && (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-5xl font-bold text-primary mb-2">{result.imported}</div>
              <p className="text-muted-foreground">leads imported out of {result.total} rows</p>
              <div className="flex gap-3 justify-center mt-6">
                <Link href="/leads"><Button>View Leads</Button></Link>
                <Button variant="outline" onClick={() => { setStep('upload'); setFile(null); setResult(null) }}>
                  Import More
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
