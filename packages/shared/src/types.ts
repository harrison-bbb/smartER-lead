// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

// ─── Email Accounts ──────────────────────────────────────────────────────────

export type SmtpProvider = 'smtp' | 'gmail' | 'outlook'

export interface EmailAccount {
  id: string
  userId: string
  name: string
  email: string
  provider: SmtpProvider
  host?: string
  port?: number
  secure?: boolean
  dailySendLimit: number
  warmupEnabled: boolean
  status: 'active' | 'error' | 'testing'
  createdAt: string
}

// ─── Leads ───────────────────────────────────────────────────────────────────

export interface Lead {
  id: string
  userId: string
  email: string
  firstName?: string
  lastName?: string
  company?: string
  title?: string
  phone?: string
  website?: string
  customFields: Record<string, string>
  status: 'active' | 'unsubscribed' | 'bounced' | 'replied'
  createdAt: string
}

export interface List {
  id: string
  userId: string
  name: string
  leadCount: number
  createdAt: string
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived'

export interface Campaign {
  id: string
  userId: string
  name: string
  status: CampaignStatus
  emailAccountId: string
  listId?: string
  trackOpens: boolean
  trackClicks: boolean
  dailyLimit: number
  sendingStartHour: number
  sendingEndHour: number
  sendingDays: number[]
  timezone: string
  createdAt: string
  updatedAt: string
}

export interface SequenceStep {
  id: string
  campaignId: string
  stepNumber: number
  subject: string
  body: string
  delayDays: number
  createdAt: string
}

// ─── Campaign Leads ───────────────────────────────────────────────────────────

export type CampaignLeadStatus =
  | 'enrolled'
  | 'in_progress'
  | 'completed'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'
  | 'paused'

export interface CampaignLead {
  id: string
  campaignId: string
  leadId: string
  status: CampaignLeadStatus
  currentStep: number
  nextSendAt?: string
  createdAt: string
}

// ─── Email Events ─────────────────────────────────────────────────────────────

export type EmailEventType = 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed'

export interface EmailEvent {
  id: string
  sentEmailId: string
  type: EmailEventType
  metadata: Record<string, string>
  createdAt: string
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface CampaignStats {
  campaignId: string
  totalLeads: number
  sent: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  unsubscribed: number
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
}

// ─── Warmup ───────────────────────────────────────────────────────────────────

export interface WarmupPool {
  id: string
  userId: string
  name: string
  accountCount: number
  createdAt: string
}

export interface WarmupAccount {
  id: string
  emailAccountId: string
  poolId: string
  rampDay: number
  dailyTarget: number
  totalSent: number
  totalReplied: number
  spamRescued: number
  status: 'active' | 'paused'
  createdAt: string
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface ApiError {
  error: string
  details?: unknown
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}
