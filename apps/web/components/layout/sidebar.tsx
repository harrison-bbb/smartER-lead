'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Mail,
  Users,
  LayoutDashboard,
  List,
  Thermometer,
  Settings,
  LogOut,
  Inbox,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logout } from '@/lib/api'
import { useRouter } from 'next/navigation'

const nav = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Campaigns', href: '/campaigns', icon: Mail },
  { label: 'Inbox', href: '/inbox', icon: Inbox },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: 'Lists', href: '/lists', icon: List },
  { label: 'Templates', href: '/templates', icon: FileText },
  { label: 'Accounts', href: '/accounts', icon: Mail },
  { label: 'Warmup', href: '/warmup', icon: Thermometer },
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center px-4 border-b">
        <Mail className="h-5 w-5 text-primary mr-2" />
        <span className="font-semibold text-sm">Outreach</span>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {nav.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              pathname === href || (href !== '/' && pathname.startsWith(href))
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-2 border-t">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
