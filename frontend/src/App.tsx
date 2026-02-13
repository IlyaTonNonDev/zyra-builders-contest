import { useEffect, useCallback, useRef, useState } from 'react'
import { TonConnectUI } from '@tonconnect/ui'
import './App.css'

import type {
  AuthState,
  ChannelCard,
  CartItem,
  PaymentInstructions,
  PaidOrderGroup,
  MyChannel,
  Campaign,
  CampaignApplication,
  MyCampaignApplication,
  TabType,
} from './types'

import { CatalogTab } from './components/CatalogTab'
import { CartTab } from './components/CartTab'
import { OrdersTab } from './components/OrdersTab'
import { MyChannelTab } from './components/MyChannelTab'
import { CampaignsTab } from './components/CampaignsTab'

function App() {
  const initDataRef = useRef<string | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'idle' })
  const [activeTab, setActiveTab] = useState<TabType>('catalog')
  const [userMode, setUserMode] = useState<'advertiser' | 'admin'>('advertiser')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [channels, setChannels] = useState<ChannelCard[]>([])
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    topic: '',
    minPrice: '',
    maxPrice: '',
    minSubscribers: '',
    maxSubscribers: '',
    minViews: '',
    maxViews: '',
    minErr: '',
    maxErr: '',
  })
  const apiUrl =
    import.meta.env.VITE_API_URL ??
    (window.location.hostname.endsWith('zyra.ee')
      ? 'https://api.zyra.ee'
      : 'http://localhost:3000')

  // Auth header для всех защищённых запросов
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {}
    if (initDataRef.current) {
      headers['Authorization'] = `tma ${initDataRef.current}`
    }
    return headers
  }, [])

  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartGroupId, setCartGroupId] = useState<number | null>(null)
  const [cartError, setCartError] = useState<string | null>(null)
  const [paymentLink, setPaymentLink] = useState<string | null>(null)
  const [paymentHint, setPaymentHint] = useState<PaymentInstructions | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [pendingPaymentId, setPendingPaymentId] = useState<number | null>(null)
  const [tonConnectUI, setTonConnectUI] = useState<TonConnectUI | null>(null)
  const [tonWalletAddress, setTonWalletAddress] = useState<string | null>(null)
  const [tonConnectError, setTonConnectError] = useState<string | null>(null)
  const [paidOrders, setPaidOrders] = useState<PaidOrderGroup[]>([])
  const [paidOrdersError, setPaidOrdersError] = useState<string | null>(null)
  const [paidOrdersLoading, setPaidOrdersLoading] = useState(false)
  const [orderActionLoading, setOrderActionLoading] = useState<number | null>(null)
  const [orderForm, setOrderForm] = useState({
    channelTelegramId: '',
    adText: '',
    publishAt: '',
  })
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [orderFormChannel, setOrderFormChannel] = useState<ChannelCard | null>(null)

  // My Channel state
  const [myChannels, setMyChannels] = useState<MyChannel[]>([])
  const [myChannelError, setMyChannelError] = useState<string | null>(null)
  const [myChannelLoading, setMyChannelLoading] = useState(false)
  const [registerChannelInput, setRegisterChannelInput] = useState('')

  // Campaigns state
  const [campaignView, setCampaignView] = useState<'browse' | 'my' | 'create'>('browse')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [myCampaigns, setMyCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [campaignApplications, setCampaignApplications] = useState<CampaignApplication[]>([])
  const [myApplications, setMyApplications] = useState<MyCampaignApplication[]>([])
  const [, setCampaignsLoading] = useState(false)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const [campaignActionLoading, setCampaignActionLoading] = useState(false)
  const [newCampaignForm, setNewCampaignForm] = useState({
    adText: '',
    budgetUsdt: '',
    pricePerPost: '',
  })
  const [applyForm, setApplyForm] = useState({
    campaignId: null as number | null,
    proposedPrice: '',
    channelTelegramId: '',
  })

  // ─── Auth ───────────────────────────────────────────────────────────
  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    webApp?.ready?.()
    const initData = webApp?.initData
    if (!initData) {
      setAuth({ status: 'error', message: 'initData отсутствует' })
      return
    }

    initDataRef.current = initData

    setAuth({ status: 'loading' })
    fetch(`${apiUrl}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ initData }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Auth failed')
        }
        return res.json()
      })
      .then((data) => {
        setAuth({ status: 'ok', telegramId: data.telegramId })
      })
      .catch((error) => {
        setAuth({ status: 'error', message: error.message })
      })
  }, [apiUrl])

  // ─── TonConnect ─────────────────────────────────────────────────────
  useEffect(() => {
    const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`
    const ui = new TonConnectUI({ manifestUrl })
    setTonConnectUI(ui)
    const unsubscribe = ui.onStatusChange((wallet: { account?: { address?: string } } | null) => {
      setTonWalletAddress(wallet?.account?.address ?? null)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  // ─── Data loaders ───────────────────────────────────────────────────
  const loadChannels = (search: string) => {
    setChannelsError(null)
    fetch(`${apiUrl}/channels${search}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load channels')
        }
        return res.json()
      })
      .then((data) => {
        setChannels(Array.isArray(data.channels) ? data.channels : [])
      })
      .catch((error) => {
        setChannelsError(error.message)
      })
  }

  const loadMyChannels = (telegramId: number) => {
    setMyChannelError(null)
    setMyChannelLoading(true)
    fetch(`${apiUrl}/channels/my/${telegramId}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load my channels')
        }
        return res.json()
      })
      .then((data) => {
        const channels = Array.isArray(data.channels) ? data.channels : []
        setMyChannels(channels)
      })
      .catch((error) => setMyChannelError(error.message))
      .finally(() => setMyChannelLoading(false))
  }

  const formatTonAddress = (address: string) =>
    address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address

  const connectTonWallet = () => {
    setTonConnectError(null)
    if (!tonConnectUI) {
      setTonConnectError('Tonkeeper недоступен')
      return
    }
    tonConnectUI.connectWallet().catch((error: unknown) => {
      setTonConnectError(error instanceof Error ? error.message : 'Не удалось подключить кошелек')
    })
  }

  const disconnectTonWallet = () => {
    setTonConnectError(null)
    if (!tonConnectUI) {
      setTonConnectError('Tonkeeper недоступен')
      return
    }
    tonConnectUI.disconnect().catch((error: unknown) => {
      setTonConnectError(error instanceof Error ? error.message : 'Не удалось отключить кошелек')
    })
    setTonWalletAddress(null)
  }

  const openCombinedTonkeeperLink = (path: string) => {
    if (!tonWalletAddress) {
      return Promise.reject(new Error('Подключите Tonkeeper'))
    }
    return fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ walletAddress: tonWalletAddress }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to create Tonkeeper link')
        }
        return res.json()
      })
      .then((data) => {
        if (!data.tonkeeperUrl) {
          throw new Error('Tonkeeper link is missing')
        }
        window.location.href = data.tonkeeperUrl
      })
  }

  useEffect(() => {
    loadChannels('')
  }, [apiUrl])

  const applyFilters = () => {
    const params = new URLSearchParams()
    if (filters.topic) params.set('topic', filters.topic)
    if (filters.minPrice) params.set('minPrice', filters.minPrice)
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice)
    if (filters.minSubscribers) params.set('minSubscribers', filters.minSubscribers)
    if (filters.maxSubscribers) params.set('maxSubscribers', filters.maxSubscribers)
    if (filters.minViews) params.set('minViews', filters.minViews)
    if (filters.maxViews) params.set('maxViews', filters.maxViews)
    if (filters.minErr) params.set('minErr', filters.minErr)
    if (filters.maxErr) params.set('maxErr', filters.maxErr)

    const query = params.toString()
    loadChannels(query ? `?${query}` : '')
    setFiltersOpen(false)
  }

  const resetFilters = () => {
    setFilters({
      topic: '',
      minPrice: '',
      maxPrice: '',
      minSubscribers: '',
      maxSubscribers: '',
      minViews: '',
      maxViews: '',
      minErr: '',
      maxErr: '',
    })
    loadChannels('')
    setFiltersOpen(false)
  }

  const loadCart = (telegramId: number) => {
    setCartError(null)
    fetch(`${apiUrl}/cart/${telegramId}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load cart')
        }
        return res.json()
      })
      .then((data) => {
        setCartGroupId(data.groupId ?? null)
        setCartItems(Array.isArray(data.items) ? data.items : [])
      })
      .catch((error) => setCartError(error.message))
  }

  useEffect(() => {
    if (auth.status === 'ok') {
      loadCart(auth.telegramId)
      loadMyChannels(auth.telegramId)
    }
  }, [auth, apiUrl])

  const loadPaidOrders = (telegramId: number) => {
    setPaidOrdersError(null)
    setPaidOrdersLoading(true)
    fetch(`${apiUrl}/orders/paid/${telegramId}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load paid orders')
        }
        return res.json()
      })
      .then((data) => {
        setPaidOrders(Array.isArray(data.groups) ? data.groups : [])
      })
      .catch((error) => setPaidOrdersError(error.message))
      .finally(() => setPaidOrdersLoading(false))
  }

  useEffect(() => {
    if (auth.status === 'ok') {
      loadPaidOrders(auth.telegramId)
    }
  }, [auth, apiUrl])

  // ─── Payment polling: check on-chain status after redirect from Tonkeeper
  useEffect(() => {
    if (!pendingPaymentId) return
    let cancelled = false
    const poll = setInterval(() => {
      if (cancelled) return
      fetch(`${apiUrl}/payments/${pendingPaymentId}/refresh`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
        .then(async (res) => {
          if (!res.ok) return // not confirmed yet or error — keep polling
          const data = await res.json()
          if (data.payment?.status === 'paid') {
            setPendingPaymentId(null)
            setPaymentError(null)
            setPaymentLink(null)
            setPaymentHint(null)
            if (auth.status === 'ok') {
              loadCart(auth.telegramId)
              loadPaidOrders(auth.telegramId)
            }
          }
        })
        .catch(() => {
          // ignore errors, keep polling
        })
    }, 10_000) // every 10 seconds

    // stop polling after 10 minutes
    const timeout = setTimeout(() => {
      clearInterval(poll)
      if (!cancelled) {
        setPendingPaymentId(null)
        setPaymentError('Время ожидания подтверждения оплаты истекло. Обновите страницу.')
      }
    }, 10 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(poll)
      clearTimeout(timeout)
    }
  }, [pendingPaymentId, apiUrl, auth])

  useEffect(() => {
    if (userMode === 'advertiser') {
      if (!['catalog', 'campaigns', 'cart', 'orders'].includes(activeTab)) {
        setActiveTab('catalog')
      }
      if (campaignView === 'browse') {
        setCampaignView('my')
        setSelectedCampaign(null)
      }
    } else {
      if (!['campaigns', 'orders', 'mychannel'].includes(activeTab)) {
        setActiveTab('campaigns')
      }
      if (campaignView !== 'browse') {
        setCampaignView('browse')
        setSelectedCampaign(null)
      }
    }
  }, [userMode, activeTab, campaignView])

  // ─── Campaigns API ──────────────────────────────────────────────────
  const loadCampaigns = () => {
    setCampaignsError(null)
    setCampaignsLoading(true)
    fetch(`${apiUrl}/campaigns`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load campaigns')
        }
        return res.json()
      })
      .then((data) => {
        setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : [])
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignsLoading(false))
  }

  const loadMyCampaigns = (telegramId: number) => {
    fetch(`${apiUrl}/campaigns/my/${telegramId}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load my campaigns')
        }
        return res.json()
      })
      .then((data) => {
        const campaigns = Array.isArray(data.campaigns) ? data.campaigns : []
        setMyCampaigns(campaigns)
        const pendingCampaigns = campaigns.filter((campaign: Campaign) => campaign.status === 'pending')
        if (pendingCampaigns.length > 0) {
          pendingCampaigns.forEach((campaign: Campaign) => {
            fetch(`${apiUrl}/campaigns/${campaign.id}/refresh`, { method: 'POST', headers: getAuthHeaders() })
              .then((res) => res.ok && loadMyCampaigns(telegramId))
              .catch(() => undefined)
          })
        }
      })
      .catch((error) => setCampaignsError(error.message))
  }

  const loadMyApplications = (telegramId: number) => {
    fetch(`${apiUrl}/campaigns/applications/my/${telegramId}`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load my applications')
        }
        return res.json()
      })
      .then((data) => {
        setMyApplications(Array.isArray(data.applications) ? data.applications : [])
      })
      .catch((error) => setCampaignsError(error.message))
  }

  const loadCampaignApplications = (campaignId: number) => {
    fetch(`${apiUrl}/campaigns/${campaignId}/applications`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load applications')
        }
        return res.json()
      })
      .then((data) => {
        setCampaignApplications(Array.isArray(data.applications) ? data.applications : [])
      })
      .catch((error) => setCampaignsError(error.message))
  }

  useEffect(() => {
    loadCampaigns()
    if (auth.status === 'ok') {
      loadMyCampaigns(auth.telegramId)
      loadMyApplications(auth.telegramId)
    }
  }, [auth, apiUrl])

  useEffect(() => {
    if (selectedCampaign) {
      loadCampaignApplications(selectedCampaign.id)
    }
  }, [selectedCampaign])

  useEffect(() => {
    if (!selectedCampaign) return
    const intervalId = setInterval(() => {
      loadCampaignApplications(selectedCampaign.id)
    }, 10000)
    return () => clearInterval(intervalId)
  }, [selectedCampaign, apiUrl])

  const createCampaign = () => {
    if (auth.status !== 'ok') return
    setCampaignsError(null)
    setCampaignActionLoading(true)
    fetch(`${apiUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        telegramId: auth.telegramId,
        adText: newCampaignForm.adText,
        budgetUsdt: Number(newCampaignForm.budgetUsdt),
        pricePerPost: newCampaignForm.pricePerPost ? Number(newCampaignForm.pricePerPost) : null,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to create campaign')
        }
        return res.json()
      })
      .then((data) => {
        const campaignId = data.campaign?.id as number | undefined
        if (!tonWalletAddress) {
          setCampaignsError(
            '⚠️ Подключите Tonkeeper для оплаты (нужна отправка 1 TON на газ). Остаток TON вернется при завершении.',
          )
          return
        }
        if (campaignId) {
          openCombinedTonkeeperLink(`/campaigns/${campaignId}/tonkeeper-link`).catch((error) => {
            setCampaignsError(error.message)
          })
        }
        setNewCampaignForm({ adText: '', budgetUsdt: '', pricePerPost: '' })
        loadMyCampaigns(auth.telegramId)
        setCampaignView('my')
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignActionLoading(false))
  }

  const applyToCampaign = (campaignId: number, channelTelegramId: number, proposedPrice: string) => {
    if (auth.status !== 'ok') return
    setCampaignsError(null)
    setCampaignActionLoading(true)
    fetch(`${apiUrl}/campaigns/${campaignId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        telegramId: auth.telegramId,
        channelTelegramId,
        proposedPrice: proposedPrice ? Number(proposedPrice) : null,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to apply')
        }
        return res.json()
      })
      .then(() => {
        loadMyApplications(auth.telegramId)
        loadCampaigns()
        setApplyForm({ campaignId: null, proposedPrice: '', channelTelegramId: '' })
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignActionLoading(false))
  }

  const acceptApplication = (campaignId: number, appId: number) => {
    if (auth.status !== 'ok') return
    setCampaignActionLoading(true)
    fetch(`${apiUrl}/campaigns/${campaignId}/accept/${appId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to accept')
        }
      })
      .then(() => {
        loadCampaignApplications(campaignId)
        loadMyCampaigns(auth.telegramId)
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignActionLoading(false))
  }

  const rejectApplication = (campaignId: number, appId: number) => {
    if (auth.status !== 'ok') return
    setCampaignActionLoading(true)
    fetch(`${apiUrl}/campaigns/${campaignId}/reject/${appId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to reject')
        }
      })
      .then(() => {
        loadCampaignApplications(campaignId)
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignActionLoading(false))
  }

  const closeCampaign = (campaignId: number) => {
    if (auth.status !== 'ok') return
    setCampaignActionLoading(true)
    fetch(`${apiUrl}/campaigns/${campaignId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to close campaign')
        }
        return res.json()
      })
      .then((data) => {
        if (data.remainingRefund > 0) {
          alert(`Кампания закрыта. Возврат: ${data.remainingRefund} USDT`)
        }
        loadMyCampaigns(auth.telegramId)
        setSelectedCampaign(null)
      })
      .catch((error) => setCampaignsError(error.message))
      .finally(() => setCampaignActionLoading(false))
  }

  // ─── Cart / Payment ─────────────────────────────────────────────────
  const addToCart = () => {
    if (auth.status !== 'ok') return
    setCartError(null)
    fetch(`${apiUrl}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        telegramId: auth.telegramId,
        channelTelegramId: Number(orderForm.channelTelegramId),
        adText: orderForm.adText,
        publishAt: orderForm.publishAt,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to add order')
        }
        return res.json()
      })
      .then(() => {
        setOrderForm({ channelTelegramId: '', adText: '', publishAt: '' })
        setOrderFormOpen(false)
        setOrderFormChannel(null)
        loadCart(auth.telegramId)
      })
      .catch((error) => setCartError(error.message))
  }

  const deleteCartItem = (orderId: number) => {
    if (auth.status !== 'ok') return
    setCartError(null)
    fetch(`${apiUrl}/cart/items/${orderId}`, { method: 'DELETE', headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to delete order')
        }
        return res.json()
      })
      .then(() => {
        loadCart(auth.telegramId)
      })
      .catch((error) => {
        const message = String(error?.message ?? error)
        if (message.includes('not in draft')) {
          setCartError('Удаление недоступно: заказ уже отправлен на оплату.')
          loadCart(auth.telegramId)
          return
        }
        setCartError(message)
      })
  }

  const checkout = (): Promise<number> => {
    if (auth.status !== 'ok') {
      return Promise.reject(new Error('Not authenticated'))
    }
    setCartError(null)
    return fetch(`${apiUrl}/cart/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
          const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(body.error || 'Failed to checkout')
        }
        return body
      })
      .then((data) => {
        const groupId = Number(data.groupId)
        if (!Number.isFinite(groupId)) {
          throw new Error('Invalid groupId')
        }
        setCartGroupId(groupId)
        return groupId
      })
  }

  const createPaymentIntent = (groupId: number) => {
    setPaymentError(null)
    setPaymentLoading(true)
    return fetch(`${apiUrl}/payments/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ groupId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to create payment intent')
        }
        return res.json()
      })
      .then((data) => {
        const instructions = data.instructions as PaymentInstructions | undefined
        const payment = data.payment as { id?: number } | undefined
        if (!instructions?.tonkeeperUrl) {
          throw new Error('Tonkeeper link is missing')
        }
        setPaymentLink(instructions.tonkeeperUrl)
        setPaymentHint(instructions)
        if (payment?.id) {
          setPendingPaymentId(payment.id)
        }
        if (!tonWalletAddress) {
          throw new Error(
            '⚠️ Подключите Tonkeeper для оплаты (нужна отправка 1 TON на газ). Остаток TON вернется при завершении.',
          )
        }
        if (payment?.id) {
          return openCombinedTonkeeperLink(`/payments/${payment.id}/tonkeeper-link`).catch((error) => {
            setPaymentError(error.message)
          })
        }
        throw new Error('Payment id is missing')
      })
      .catch((error) => setPaymentError(error.message))
      .finally(() => setPaymentLoading(false))
  }

  const openTonkeeper = () => {
    checkout()
      .then((groupId) => createPaymentIntent(groupId))
      .catch((error) => setPaymentError(error.message))
  }

  // ─── Orders ─────────────────────────────────────────────────────────
  const publishOrder = (orderId: number) => {
    if (auth.status !== 'ok') return
    setPaidOrdersError(null)
    setOrderActionLoading(orderId)
    fetch(`${apiUrl}/orders/${orderId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to publish order')
        }
      })
      .then(() => loadPaidOrders(auth.telegramId))
      .catch((error) => setPaidOrdersError(error.message))
      .finally(() => setOrderActionLoading(null))
  }

  const publishCampaignApplication = (applicationId: number) => {
    if (auth.status !== 'ok') return
    setPaidOrdersError(null)
    setOrderActionLoading(applicationId)
    fetch(`${apiUrl}/campaigns/applications/${applicationId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to publish campaign')
        }
      })
      .then(() => loadPaidOrders(auth.telegramId))
      .catch((error) => setPaidOrdersError(error.message))
      .finally(() => setOrderActionLoading(null))
  }

  const rejectOrder = (orderId: number) => {
    if (auth.status !== 'ok') return
    setPaidOrdersError(null)
    setOrderActionLoading(orderId)
    fetch(`${apiUrl}/orders/${orderId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ telegramId: auth.telegramId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to reject order')
        }
      })
      .then(() => loadPaidOrders(auth.telegramId))
      .catch((error) => setPaidOrdersError(error.message))
      .finally(() => setOrderActionLoading(null))
  }

  // ─── Channel management ─────────────────────────────────────────────
  const registerChannel = () => {
    if (auth.status !== 'ok') return
    if (!registerChannelInput.trim()) {
      setMyChannelError('Введите @username канала')
      return
    }
    setMyChannelError(null)
    setMyChannelLoading(true)
    fetch(`${apiUrl}/channels/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        telegramId: auth.telegramId,
        channel: registerChannelInput.trim(),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to register channel')
        }
        return res.json()
      })
      .then(() => {
        setRegisterChannelInput('')
        loadMyChannels(auth.telegramId)
        loadChannels('')
      })
      .catch((error) => setMyChannelError(error.message))
      .finally(() => setMyChannelLoading(false))
  }

  const updateChannelCard = (channelTelegramId: string, formData: {
    topic: string
    priceUsdt: string
    subscribers: string
    avgViews: string
    payoutAddress: string
  }) => {
    setMyChannelError(null)
    setMyChannelLoading(true)
    fetch(`${apiUrl}/channels/${channelTelegramId}/card`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        topic: formData.topic || null,
        priceUsdt: formData.priceUsdt ? Number(formData.priceUsdt) : null,
        subscribers: formData.subscribers ? Number(formData.subscribers) : null,
        avgViews: formData.avgViews ? Number(formData.avgViews) : null,
        payoutAddress: formData.payoutAddress || null,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to update channel')
        }
        return res.json()
      })
      .then(() => {
        if (auth.status === 'ok') loadMyChannels(auth.telegramId)
        loadChannels('')
      })
      .catch((error) => setMyChannelError(error.message))
      .finally(() => setMyChannelLoading(false))
  }

  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.price_usdt ?? 0), 0)

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <div className="header-logo-icon">📢</div>
          <span>Zyra</span>
        </div>
      {auth.status === 'ok' && (
          <div className="header-user">
            <span>ID:</span>
            <span className="header-user-id">{auth.telegramId}</span>
          </div>
        )}
      </header>

      {/* Status Bar */}
      {auth.status === 'idle' && (
        <div className="status-bar">Ожидание initData...</div>
      )}
      {auth.status === 'loading' && (
        <div className="status-bar loading">Авторизация...</div>
      )}
      {auth.status === 'error' && (
        <div className="error-banner">{auth.message}</div>
      )}

      {/* Mode Switcher */}
      <div className="campaigns-switcher" style={{ margin: '0 16px 12px' }}>
        <button
          className={`switcher-btn ${userMode === 'admin' ? 'active' : ''}`}
          onClick={() => {
            setUserMode('admin')
            setActiveTab('campaigns')
            setCampaignView('browse')
            setSelectedCampaign(null)
            setCampaignsError(null)
          }}
        >
          🛡️ Админ канала
        </button>
        <button
          className={`switcher-btn ${userMode === 'advertiser' ? 'active' : ''}`}
          onClick={() => {
            setUserMode('advertiser')
            setActiveTab('catalog')
            setCampaignView('my')
            setSelectedCampaign(null)
            setCampaignsError(null)
          }}
        >
          📣 Заказчик
        </button>
      </div>

      {/* Tabs */}
      <nav className="tabs">
        {userMode === 'advertiser' && (
          <button
            className={`tab ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            Каталог
          </button>
        )}
        <button
          className={`tab ${activeTab === 'campaigns' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('campaigns')
            if (userMode === 'admin') {
              setCampaignView('browse')
            } else if (campaignView === 'browse') {
              setCampaignView('my')
            }
          }}
        >
          Кампании
        </button>
        {userMode === 'advertiser' && (
          <button
            className={`tab ${activeTab === 'cart' ? 'active' : ''}`}
            onClick={() => setActiveTab('cart')}
          >
            Корзина
            {cartItems.length > 0 && (
              <span className="tab-badge">{cartItems.length}</span>
            )}
          </button>
        )}
        <button
          className={`tab ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          Заказы
        </button>
        {userMode === 'admin' && (
          <button
            className={`tab ${activeTab === 'mychannel' ? 'active' : ''}`}
            onClick={() => setActiveTab('mychannel')}
          >
            Мой канал
          </button>
        )}
      </nav>

      {/* Main Content */}
      <main className="main">
        {activeTab === 'catalog' && (
          <CatalogTab
            channels={channels}
            channelsError={channelsError}
            filtersOpen={filtersOpen}
            setFiltersOpen={setFiltersOpen}
            filters={filters}
            setFilters={setFilters}
            applyFilters={applyFilters}
            resetFilters={resetFilters}
            orderFormOpen={orderFormOpen}
            orderFormChannel={orderFormChannel}
            orderForm={orderForm}
            setOrderForm={setOrderForm}
            setOrderFormOpen={setOrderFormOpen}
            setOrderFormChannel={setOrderFormChannel}
            addToCart={addToCart}
          />
        )}

        {activeTab === 'cart' && (
          <CartTab
            auth={auth}
            cartItems={cartItems}
            cartError={cartError}
            cartGroupId={cartGroupId}
            paymentLink={paymentLink}
            paymentHint={paymentHint}
            paymentError={paymentError}
            deleteCartItem={deleteCartItem}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            auth={auth}
            paidOrders={paidOrders}
            paidOrdersError={paidOrdersError}
            paidOrdersLoading={paidOrdersLoading}
            loadPaidOrders={loadPaidOrders}
            orderActionLoading={orderActionLoading}
            publishOrder={publishOrder}
            publishCampaignApplication={publishCampaignApplication}
            rejectOrder={rejectOrder}
          />
        )}

        {activeTab === 'mychannel' && (
          <MyChannelTab
            auth={auth}
            myChannels={myChannels}
            myChannelError={myChannelError}
            myChannelLoading={myChannelLoading}
            registerChannelInput={registerChannelInput}
            setRegisterChannelInput={setRegisterChannelInput}
            registerChannel={registerChannel}
            updateChannelCard={updateChannelCard}
          />
        )}

        {activeTab === 'campaigns' && (
          <CampaignsTab
            auth={auth}
            userMode={userMode}
            campaigns={campaigns}
            myCampaigns={myCampaigns}
            selectedCampaign={selectedCampaign}
            setSelectedCampaign={setSelectedCampaign}
            campaignView={campaignView}
            setCampaignView={setCampaignView}
            campaignsError={campaignsError}
            setCampaignsError={setCampaignsError}
            campaignApplications={campaignApplications}
            myApplications={myApplications}
            campaignActionLoading={campaignActionLoading}
            newCampaignForm={newCampaignForm}
            setNewCampaignForm={setNewCampaignForm}
            createCampaign={createCampaign}
            applyForm={applyForm}
            setApplyForm={setApplyForm}
            applyToCampaign={applyToCampaign}
            acceptApplication={acceptApplication}
            rejectApplication={rejectApplication}
            closeCampaign={closeCampaign}
            channels={channels}
            tonWalletAddress={tonWalletAddress}
            connectTonWallet={connectTonWallet}
            disconnectTonWallet={disconnectTonWallet}
            tonConnectError={tonConnectError}
            formatTonAddress={formatTonAddress}
          />
        )}
    </main>

      {/* Sticky Cart Footer */}
      {activeTab === 'cart' && cartItems.length > 0 && auth.status === 'ok' && (
        <div className="cart-footer">
          <div className="cart-footer-content">
            <div className="cart-total">
              <span className="cart-total-label">{cartItems.length} заказ(ов)</span>
              <span className="cart-total-amount">{cartTotal} USDT</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              {tonWalletAddress ? (
                <div className="form-hint">
                  Tonkeeper: {formatTonAddress(tonWalletAddress)}
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: '8px' }}
                    onClick={disconnectTonWallet}
                  >
                    Отключить
                  </button>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={connectTonWallet}>
                  🔗 Подключить Tonkeeper
                </button>
              )}
              {tonConnectError && (
                <div style={{ color: 'var(--color-danger)', fontSize: '12px' }}>{tonConnectError}</div>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={openTonkeeper}
              disabled={paymentLoading}
            >
              {paymentLoading ? '⏳ Загрузка...' : '💎 Оплатить'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
