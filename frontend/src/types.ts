export type AuthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; telegramId: number }
  | { status: 'error'; message: string }

export type ChannelCard = {
  telegram_id: string
  title: string
  username: string | null
  topic: string | null
  price_usdt: string | null
  subscribers: number | null
  avg_views: number | null
  err: string | null
}

export type CartItem = {
  id: number
  channel_telegram_id: string
  ad_text: string
  publish_at: string
  created_at?: string
  price_usdt: string | null
  title: string | null
  username: string | null
}

export type PaymentInstructions = {
  tonkeeperUrl: string
  comment: string
  jettonAmount: string
  requiredTonNano?: string
}

export type PaidOrderItem = {
  id: number
  source?: 'orders' | 'campaign'
  campaignId?: number | null
  adText: string
  publishAt: string
  publishedMessageId: number | null
  publishedChannelId: string | null
  publishedAt: string | null
  publishStatus: string | null
  publishError: string | null
  verifyStatus: string | null
  verifiedAt: string | null
  verifyError: string | null
  payoutStatus?: string | null
  payoutReadyAt?: string | null
  payoutTxHash?: string | null
  payoutError?: string | null
  priceUsdt: string | null
  title: string | null
  username: string | null
}

export type PaidOrderGroup = {
  groupId: number
  createdAt: string
  paymentId: number
  paymentStatus: string
  totalUsdt: string | null
  refundStatus: string | null
  refundTxHash: string | null
  refundError: string | null
  payoutStatus: string | null
  payoutReadyAt: string | null
  payoutTxHash: string | null
  payoutError: string | null
  items: PaidOrderItem[]
}

export type MyChannel = {
  telegram_id: string
  title: string
  username: string | null
  topic: string | null
  price_usdt: string | null
  subscribers: number | null
  avg_views: number | null
  err: string | null
  payout_address: string | null
}

// ===== CAMPAIGNS TYPES =====
export type Campaign = {
  id: number
  advertiser_telegram_id: number
  ad_text: string
  budget_usdt: string
  price_per_post: string | null
  remaining_usdt: string
  status: 'pending' | 'active' | 'closed' | 'cancelled'
  pending_count?: number
  accepted_count?: number
  published_count?: number
  applications_count?: number
  created_at: string
}

export type CampaignApplication = {
  id: number
  campaign_id: number
  channel_id: number
  channel_title: string
  channel_username: string | null
  channel_subscribers: number | null
  channel_avg_views: number | null
  proposed_price: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'published' | 'paid'
  created_at: string
}

export type MyCampaignApplication = {
  id: number
  campaign_id: number
  campaign_ad_text: string
  campaign_budget_usdt: string
  campaign_price_per_post: string | null
  proposed_price: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'published' | 'paid'
  created_at: string
}

export type TabType = 'catalog' | 'cart' | 'orders' | 'mychannel' | 'campaigns'

// CPM rates in RUB per 1000 views (min, max)
export const CPM_RATES: Record<string, [number, number]> = {
  business: [600, 1200],
  crypto: [600, 1200],
  tech: [400, 800],
  lifestyle: [300, 600],
  news: [200, 500],
  education: [200, 300],
  entertainment: [100, 300],
}

export const RUB_TO_USDT = 80

// Calculate recommended price based on avg views and topic
export function getRecommendedPrice(avgViews: number, topic: string): { min: number; max: number } | null {
  const rates = CPM_RATES[topic]
  if (!rates || !avgViews || avgViews <= 0) return null

  const [cpmMin, cpmMax] = rates
  const min = Math.round((avgViews / 1000) * cpmMin / RUB_TO_USDT)
  const max = Math.round((avgViews / 1000) * cpmMax / RUB_TO_USDT)

  return { min: Math.max(1, min), max: Math.max(1, max) }
}
