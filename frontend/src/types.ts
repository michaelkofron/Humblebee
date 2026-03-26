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
}

export type HiveConditionType = 'event_name' | 'page_path_equals' | 'page_path_contains'
export type HiveSequence = 'anytime' | 'immediately'

export interface HiveCondition {
  type: HiveConditionType
  value: string
  sequence: HiveSequence
}

export interface Hive {
  id: string
  name: string
  site_id: string | null
  conditions: HiveCondition[]
  created_at: string
  updated_at: string
}

export type View = 'overview' | 'colonies'
