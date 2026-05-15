import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const smtpProviderEnum = pgEnum('smtp_provider', ['smtp', 'gmail', 'outlook'])
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft', 'active', 'paused', 'completed', 'archived',
])
export const campaignLeadStatusEnum = pgEnum('campaign_lead_status', [
  'enrolled', 'in_progress', 'completed', 'replied', 'bounced', 'unsubscribed', 'paused',
])
export const emailEventTypeEnum = pgEnum('email_event_type', [
  'sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed',
])
export const leadStatusEnum = pgEnum('lead_status', [
  'active', 'unsubscribed', 'bounced', 'replied',
])
export const emailAccountStatusEnum = pgEnum('email_account_status', [
  'active', 'error', 'testing',
])
export const warmupAccountStatusEnum = pgEnum('warmup_account_status', ['active', 'paused'])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Email Accounts ───────────────────────────────────────────────────────────

export const emailAccounts = pgTable('email_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),        // internal label, e.g. "Gmail Account"
  senderName: text('sender_name'),      // display name in outgoing emails, e.g. "Harrison Smith"
  email: text('email').notNull(),
  provider: smtpProviderEnum('provider').notNull().default('smtp'),
  // SMTP settings
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpSecure: boolean('smtp_secure').default(true),
  // Credentials stored AES-256-GCM encrypted
  encryptedUsername: text('encrypted_username'),
  encryptedPassword: text('encrypted_password'),
  // IMAP settings
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  imapSecure: boolean('imap_secure').default(true),
  // Sending limits
  dailySendLimit: integer('daily_send_limit').notNull().default(50),
  sentTodayCount: integer('sent_today_count').notNull().default(0),
  sentTodayDate: text('sent_today_date'), // YYYY-MM-DD
  // Status
  status: emailAccountStatusEnum('status').notNull().default('testing'),
  lastError: text('last_error'),
  warmupEnabled: boolean('warmup_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Leads & Lists ────────────────────────────────────────────────────────────

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  company: text('company'),
  title: text('title'),
  phone: text('phone'),
  website: text('website'),
  customFields: jsonb('custom_fields').notNull().default({}),
  status: leadStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const listLeads = pgTable('list_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Templates ────────────────────────────────────────────────────────────────

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: campaignStatusEnum('status').notNull().default('draft'),
  emailAccountId: uuid('email_account_id').references(() => emailAccounts.id, { onDelete: 'set null' }),
  listId: uuid('list_id').references(() => lists.id, { onDelete: 'set null' }),
  trackOpens: boolean('track_opens').notNull().default(true),
  trackClicks: boolean('track_clicks').notNull().default(true),
  dailyLimit: integer('daily_limit').notNull().default(50),
  sendingStartHour: integer('sending_start_hour').notNull().default(8),
  sendingEndHour: integer('sending_end_hour').notNull().default(18),
  sendingDays: jsonb('sending_days').notNull().default([1, 2, 3, 4, 5]), // Mon–Fri
  timezone: text('timezone').notNull().default('America/New_York'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const sequenceSteps = pgTable('sequence_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  delayDays: integer('delay_days').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Campaign Leads ───────────────────────────────────────────────────────────

export const campaignLeads = pgTable('campaign_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  status: campaignLeadStatusEnum('status').notNull().default('enrolled'),
  currentStep: integer('current_step').notNull().default(0),
  nextSendAt: timestamp('next_send_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Sent Emails ──────────────────────────────────────────────────────────────

export const sentEmails = pgTable('sent_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignLeadId: uuid('campaign_lead_id').notNull().references(() => campaignLeads.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').references(() => sequenceSteps.id, { onDelete: 'set null' }),
  messageId: text('message_id'), // SMTP Message-ID header
  subject: text('subject').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
})

// ─── Email Events ─────────────────────────────────────────────────────────────

export const emailEvents = pgTable('email_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sentEmailId: uuid('sent_email_id').notNull().references(() => sentEmails.id, { onDelete: 'cascade' }),
  type: emailEventTypeEnum('type').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Stores hashed link → original URL for click tracking
export const linkMap = pgTable('link_map', {
  id: uuid('id').primaryKey().defaultRandom(),
  sentEmailId: uuid('sent_email_id').notNull().references(() => sentEmails.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull().unique(),
  originalUrl: text('original_url').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Warmup ───────────────────────────────────────────────────────────────────

export const warmupPools = pgTable('warmup_pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const warmupAccounts = pgTable('warmup_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailAccountId: uuid('email_account_id').notNull().references(() => emailAccounts.id, { onDelete: 'cascade' }),
  poolId: uuid('pool_id').notNull().references(() => warmupPools.id, { onDelete: 'cascade' }),
  rampDay: integer('ramp_day').notNull().default(1),
  dailyTarget: integer('daily_target').notNull().default(2),
  maxDailyTarget: integer('max_daily_target').notNull().default(40),
  totalSent: integer('total_sent').notNull().default(0),
  totalReplied: integer('total_replied').notNull().default(0),
  spamRescued: integer('spam_rescued').notNull().default(0),
  status: warmupAccountStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const warmupEmails = pgTable('warmup_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAccountId: uuid('from_account_id').notNull().references(() => warmupAccounts.id, { onDelete: 'cascade' }),
  toAccountId: uuid('to_account_id').notNull().references(() => warmupAccounts.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  subject: text('subject').notNull(),
  replied: boolean('replied').notNull().default(false),
  foundInSpam: boolean('found_in_spam').notNull().default(false),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
})

// ─── Replies ─────────────────────────────────────────────────────────────────

export const replies = pgTable('replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignLeadId: uuid('campaign_lead_id').notNull().references(() => campaignLeads.id, { onDelete: 'cascade' }),
  sentEmailId: uuid('sent_email_id').references(() => sentEmails.id, { onDelete: 'set null' }),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  subject: text('subject'),
  bodySnippet: text('body_snippet'),   // first 500 chars
  bodyFull: text('body_full'),
  messageId: text('message_id'),
  read: boolean('read').notNull().default(false),
  tag: text('tag'),   // 'interested' | 'not_interested' | 'meeting_booked' | 'out_of_office' | 'not_now'
  repliedAt: timestamp('replied_at'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Blocklist ────────────────────────────────────────────────────────────────

export const blocklistTypeEnum = pgEnum('blocklist_type', ['email', 'domain'])

export const blocklist = pgTable('blocklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),          // e.g. "spam@example.com" or "competitor.com"
  type: blocklistTypeEnum('type').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  emailAccounts: many(emailAccounts),
  leads: many(leads),
  lists: many(lists),
  campaigns: many(campaigns),
  warmupPools: many(warmupPools),
}))

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  user: one(users, { fields: [campaigns.userId], references: [users.id] }),
  emailAccount: one(emailAccounts, { fields: [campaigns.emailAccountId], references: [emailAccounts.id] }),
  list: one(lists, { fields: [campaigns.listId], references: [lists.id] }),
  steps: many(sequenceSteps),
  campaignLeads: many(campaignLeads),
}))

export const campaignLeadsRelations = relations(campaignLeads, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [campaignLeads.campaignId], references: [campaigns.id] }),
  lead: one(leads, { fields: [campaignLeads.leadId], references: [leads.id] }),
  sentEmails: many(sentEmails),
}))

export const sentEmailsRelations = relations(sentEmails, ({ one, many }) => ({
  campaignLead: one(campaignLeads, { fields: [sentEmails.campaignLeadId], references: [campaignLeads.id] }),
  step: one(sequenceSteps, { fields: [sentEmails.stepId], references: [sequenceSteps.id] }),
  events: many(emailEvents),
  links: many(linkMap),
}))
