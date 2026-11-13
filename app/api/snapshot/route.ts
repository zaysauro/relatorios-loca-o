import { NextResponse } from 'next/server'
import { head } from '@vercel/blob'

// Devolve o retrato mais recente (gerado pela sincronização do Monday e guardado no Vercel Blob).
export const dynamic = 'force-dynamic'

export async function GET() {
  const path = process.env.SNAPSHOT_PATH
  if (!path || !process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Portal ainda não configurado.' }, { status: 503 })
  try {
    const meta = await head(path)
    const r = await fetch(meta.url, { cache: 'no-store' })
    if (!r.ok) throw new Error('blob ' + r.status)
    return new NextResponse(r.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } })
  } catch {
    return NextResponse.json({ error: 'Os dados ainda não foram sincronizados com o Monday. Tente em alguns minutos.' }, { status: 503 })
  }
}
