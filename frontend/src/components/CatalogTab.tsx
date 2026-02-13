import type { ChannelCard } from '../types'

type CatalogTabProps = {
  channels: ChannelCard[]
  channelsError: string | null
  filtersOpen: boolean
  setFiltersOpen: (v: boolean) => void
  filters: {
    topic: string
    minPrice: string
    maxPrice: string
    minSubscribers: string
    maxSubscribers: string
    minViews: string
    maxViews: string
    minErr: string
    maxErr: string
  }
  setFilters: React.Dispatch<React.SetStateAction<CatalogTabProps['filters']>>
  applyFilters: () => void
  resetFilters: () => void
  orderFormOpen: boolean
  orderFormChannel: ChannelCard | null
  orderForm: { channelTelegramId: string; adText: string; publishAt: string }
  setOrderForm: React.Dispatch<React.SetStateAction<CatalogTabProps['orderForm']>>
  setOrderFormOpen: (v: boolean) => void
  setOrderFormChannel: (v: ChannelCard | null) => void
  addToCart: () => void
}

export function CatalogTab({
  channels,
  channelsError,
  filtersOpen,
  setFiltersOpen,
  filters,
  setFilters,
  applyFilters,
  resetFilters,
  orderFormOpen,
  orderFormChannel,
  orderForm,
  setOrderForm,
  setOrderFormOpen,
  setOrderFormChannel,
  addToCart,
}: CatalogTabProps) {
  return (
    <>
      {/* Filters Toggle */}
      <button
        className={`filters-toggle ${filtersOpen ? 'open' : ''}`}
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        <span>🔍 Фильтры</span>
        <span className="filters-toggle-icon">▼</span>
      </button>

      {/* Filters Panel */}
      <div className={`filters-panel ${filtersOpen ? 'open' : ''}`}>
        <div className="filters-grid">
          <div className="filter-field full">
            <label className="filter-label">Тематика</label>
            <select
              value={filters.topic}
              onChange={(e) => setFilters((prev) => ({ ...prev, topic: e.target.value }))}
            >
              <option value="">Все тематики</option>
              <option value="business">Business</option>
              <option value="crypto">Crypto</option>
              <option value="education">Education</option>
              <option value="entertainment">Entertainment</option>
              <option value="lifestyle">Lifestyle</option>
              <option value="news">News</option>
              <option value="tech">Tech</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Цена от</label>
            <input
              type="number"
              placeholder="0"
              value={filters.minPrice}
              onChange={(e) => setFilters((prev) => ({ ...prev, minPrice: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">Цена до</label>
            <input
              type="number"
              placeholder="∞"
              value={filters.maxPrice}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxPrice: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">Подписчики от</label>
            <input
              type="number"
              placeholder="0"
              value={filters.minSubscribers}
              onChange={(e) => setFilters((prev) => ({ ...prev, minSubscribers: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">Подписчики до</label>
            <input
              type="number"
              placeholder="∞"
              value={filters.maxSubscribers}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxSubscribers: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">Просмотры от</label>
            <input
              type="number"
              placeholder="0"
              value={filters.minViews}
              onChange={(e) => setFilters((prev) => ({ ...prev, minViews: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">Просмотры до</label>
            <input
              type="number"
              placeholder="∞"
              value={filters.maxViews}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxViews: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">ERR от</label>
            <input
              type="number"
              placeholder="0"
              value={filters.minErr}
              onChange={(e) => setFilters((prev) => ({ ...prev, minErr: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label className="filter-label">ERR до</label>
            <input
              type="number"
              placeholder="∞"
              value={filters.maxErr}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxErr: e.target.value }))}
            />
          </div>
        </div>
        <div className="filters-actions">
          <button className="btn btn-secondary" onClick={resetFilters}>
            Сбросить
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={applyFilters}>
            Применить
          </button>
        </div>
      </div>

      {/* Channels Error */}
      {channelsError && <div className="error-banner">{channelsError}</div>}

      {/* Order Form (opened from channel card) */}
      {orderFormOpen && orderFormChannel && (
        <div className="order-form">
          <div className="form-title">✨ Новый заказ</div>
          <div className="form-fields">
            <div className="form-field">
              <label>Канал</label>
              <select value={orderForm.channelTelegramId} disabled>
                <option value={orderForm.channelTelegramId}>
                  {orderFormChannel.title} — {orderFormChannel.price_usdt ?? '—'} USDT
                </option>
              </select>
            </div>
            <div className="form-field">
              <label>Текст объявления</label>
              <textarea
                placeholder="Введите текст рекламы..."
                value={orderForm.adText}
                onChange={(e) =>
                  setOrderForm((prev) => ({ ...prev, adText: e.target.value }))
                }
              />
            </div>
            <div className="form-field">
              <label>Дата и время публикации (UTC+3)</label>
              <input
                type="datetime-local"
                value={orderForm.publishAt}
                onChange={(e) =>
                  setOrderForm((prev) => ({ ...prev, publishAt: e.target.value }))
                }
              />
            </div>
            <button className="btn btn-success btn-block" onClick={addToCart}>
              Добавить в корзину
            </button>
          </div>
        </div>
      )}

      {/* Channels List */}
      {!channelsError && channels.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📢</div>
          <div className="empty-text">Каналов пока нет</div>
        </div>
      )}

      <div className="channels-list">
        {channels.map((channel) => (
          <article className="channel-card" key={channel.telegram_id}>
            <div className="channel-header">
              <div className="channel-avatar">📺</div>
              <div className="channel-info">
                <div className="channel-title">{channel.title}</div>
                <div className="channel-username">
                  @{channel.username ?? 'без_username'}
                </div>
              </div>
              <div className="channel-price">
                {channel.price_usdt ?? '—'} USDT
              </div>
            </div>
            <div className="channel-stats">
              <span className="channel-stat channel-topic">
                {channel.topic ?? 'Без темы'}
              </span>
              <span className="channel-stat">
                <span className="channel-stat-icon">👥</span>
                {channel.subscribers ?? '—'}
              </span>
              <span className="channel-stat">
                <span className="channel-stat-icon">👁</span>
                {channel.avg_views ?? '—'}
              </span>
              <span className="channel-stat">
                ERR: {channel.err ?? '—'}%
              </span>
            </div>
            <div className="channel-actions">
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  setOrderForm({
                    channelTelegramId: String(channel.telegram_id),
                    adText: '',
                    publishAt: '',
                  })
                  setOrderFormChannel(channel)
                  setOrderFormOpen(true)
                }}
              >
                Заказать публикацию
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
