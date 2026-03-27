export interface Site {
  site_id: string
  site_uuid: string
  site_name: string
  domain: string
  created_at: string
}

export interface OverviewStats {
  total_uuids: number
  total_sessions: number
  total_events: number
  total_actions: number
  total_pageviews: number
  top_pages: { page_path: string; views: number }[]
  top_events: { event_name: string; count: number }[]
}

export interface JourneyEvent {
  event_id: string
  site_id: string
  session_id: string
  event_name: string
  page_path: string | null
  timestamp: string
  properties: Record<string, string | number | boolean> | null
  site_name: string
}

export interface Journey {
  uuid: string
  events: JourneyEvent[]
}

export interface UuidRow {
  uuid: string
  site_id: string
  site_name: string
  first_seen: string
  last_seen: string
  session_count: number
  page_count: number
  first_custom_event: string | null
  custom_event_count: number
}

export type HiveConditionField = 'event_name' | 'page_path' | 'page_referrer' | 'entry_page'
export type HiveConditionMatch = 'is' | 'is_not' | 'contains' | 'does_not_contain'
export type HiveSequence = 'anytime' | 'immediately' | 'next_session'
export type StepOperator = 'and' | 'or'

export interface ConditionRow {
  field: HiveConditionField
  match: HiveConditionMatch
  value: string
}

export interface ConditionStep {
  sequence: HiveSequence      // how this step relates to the previous step (ignored for first)
  operator: StepOperator      // how conditions within this step are combined
  conditions: ConditionRow[]
}

export interface Hive {
  id: string
  name: string
  site_id: string | null
  steps: ConditionStep[]
  created_at: string
  updated_at: string
}

export interface Pollination {
  id: string
  name: string
  site_id: string | null
  hive_a_id: string
  hive_b_id: string
  created_at: string
}

export interface PollinationCount {
  a_count: number
  b_count: number
  overlap: number
  a_only: number
  b_only: number
}

export type View = 'overview' | 'colonies' | 'pollinate'
