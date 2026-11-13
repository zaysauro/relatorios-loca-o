import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Relatórios da Locação',
  description: 'Resultados da equipe de Locação a partir do Monday.',
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>
}
