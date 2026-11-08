import * as React from 'react'
import { renderSVG } from 'uqr'
import { cn } from '@/lib/utils'

// QRCode (v1.8.6) — enrôlement TOTP sans recopie manuelle.
// uqr (zero-dep) : rendu SVG pur, aucun runtime externe.
export function QRCode({ data, className, size = 160 }: { data: string; className?: string; size?: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!ref.current) return
    try {
      ref.current.innerHTML = renderSVG(data, {
        pixelSize: 4,
        border: 2,
        ecc: 'M',
        blackColor: '#19271F',
        whiteColor: '#FFFFFF',
      })
    } catch { /* QR illisible : la clé texte reste affichée en secours */ }
  }, [data])
  return <div ref={ref} className={cn('inline-block bg-white rounded-lg p-1.5', className)} role="img" aria-label="TOTP QR code" />
}
