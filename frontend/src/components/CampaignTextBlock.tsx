import { useState, useRef, useLayoutEffect } from 'react'

export function CampaignTextBlock({
  text,
  className = 'campaign-text',
}: {
  text: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [isOverflow, setIsOverflow] = useState(false)
  const textRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!textRef.current || expanded) return
    const el = textRef.current
    setIsOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  return (
    <div className="campaign-text-wrapper">
      <div ref={textRef} className={`${className} ${expanded ? '' : 'clamped'}`}>
        {text}
      </div>
      {isOverflow && (
        <button
          className="btn btn-secondary btn-sm campaign-text-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </div>
  )
}
