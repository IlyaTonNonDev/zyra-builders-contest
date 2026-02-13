import type { AuthState, CartItem, PaymentInstructions } from '../types'

type CartTabProps = {
  auth: AuthState
  cartItems: CartItem[]
  cartError: string | null
  cartGroupId: number | null
  paymentLink: string | null
  paymentHint: PaymentInstructions | null
  paymentError: string | null
  deleteCartItem: (orderId: number) => void
}

export function CartTab({
  auth,
  cartItems,
  cartError,
  cartGroupId,
  paymentLink,
  paymentHint,
  paymentError,
  deleteCartItem,
}: CartTabProps) {
  return (
    <div className="cart-section">
      {auth.status !== 'ok' ? (
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-text">Авторизуйтесь через Telegram</div>
        </div>
      ) : (
        <>
          {/* Cart Error */}
          {cartError && <div className="error-banner">{cartError}</div>}

          {/* Cart Items */}
          {cartItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🛒</div>
              <div className="empty-text">Корзина пуста</div>
            </div>
          ) : (
            <>
              <div className="cart-items">
                {cartItems
                  .filter((item) => {
                    if (!item.created_at) return true
                    const created = new Date(item.created_at).getTime()
                    if (Number.isNaN(created)) return true
                    return Date.now() - created <= 45 * 60 * 1000
                  })
                  .map((item) => (
                    <div key={item.id} className="cart-item">
                      <div className="cart-item-header">
                        <div>
                          <div className="cart-item-channel">{item.title ?? 'Канал'}</div>
                          <div className="cart-item-username">
                            @{item.username ?? 'без_username'}
                          </div>
                        </div>
                        <div className="cart-item-price">{item.price_usdt ?? '—'} USDT</div>
                      </div>
                      <div className="cart-item-details">
                        <div className="cart-item-text">{item.ad_text}</div>
                        <div className="cart-item-date">
                          📅 {new Date(item.publish_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="cart-item-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => deleteCartItem(item.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Payment Info */}
              {(cartGroupId || paymentLink || paymentHint || paymentError) && (
                <div className="payment-info">
                  {cartGroupId && <p>Группа заказа: <strong>{cartGroupId}</strong></p>}
                  {paymentLink && (
                    <p>
                      Tonkeeper не открылся?{' '}
                      <a href={paymentLink} target="_blank" rel="noreferrer">
                        Открыть вручную →
                      </a>
                    </p>
                  )}
                  {paymentHint && (
                    <p>Комментарий: <strong>{paymentHint.comment}</strong></p>
                  )}
                  {paymentError && (
                    <p style={{ color: 'var(--color-danger)' }}>{paymentError}</p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
