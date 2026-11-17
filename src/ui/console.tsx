'use client';
import { useState } from 'react';
import Link from 'next/link';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { create } from 'zustand';
import { Activity, BarChart3, Building2, ChevronDown, ChevronsUpDown, ClipboardList, Container, Flame, Gauge,
  Headphones, LayoutDashboard, LogOut, Menu, MessageCircle, Package, PanelLeftClose, Receipt, Search, Settings2, ShieldCheck, Truck, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import { api } from './api';
import type { Scope } from './types';
import { Dashboard } from './dashboard';
import { BookingWorkspace } from './bookings';
import { Records } from './records';

type Item = { route: string; label: string; icon: LucideIcon; permission?: string };
const agency: { label: string; items: Item[] }[] = [
  { label: 'Overview', items: [{ route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read' }] },
  { label: 'Operations', items: [
    { route: 'bookings', label: 'Bookings', icon: ClipboardList, permission: 'booking:read' },
    { route: 'customers', label: 'Customers', icon: Users, permission: 'customer:read' },
    { route: 'connections', label: 'Connections', icon: Gauge, permission: 'customer:read' },
    { route: 'inventory', label: 'Inventory', icon: Package, permission: 'inventory:read' },
    { route: 'deliveries', label: 'Deliveries', icon: Truck, permission: 'delivery:assign' },
    { route: 'products', label: 'Products & pricing', icon: Container, permission: 'catalog:read' },
  ] },
  { label: 'Business', items: [
    { route: 'payments', label: 'Payments', icon: Wallet, permission: 'finance:read' },
    { route: 'invoices', label: 'Invoices', icon: Receipt, permission: 'finance:read' },
    { route: 'complaints', label: 'Support', icon: Headphones, permission: 'support:read' },
    { route: 'communications/whatsapp', label: 'WhatsApp', icon: MessageCircle, permission: 'integration:manage' },
    { route: 'reports', label: 'Reports', icon: BarChart3, permission: 'reports:read' },
  ] },
  { label: 'Administration', items: [
    { route: 'staff', label: 'Staff', icon: ShieldCheck, permission: 'staff:manage' },
    { route: 'branches', label: 'Branches', icon: Building2, permission: 'staff:manage' },
    { route: 'settings', label: 'Settings', icon: Settings2, permission: 'integration:manage' },
  ] },
];
const portal = [{ label: 'My account', items: [
  { route: 'dashboard', label: 'My bookings', icon: LayoutDashboard },
  { route: 'book-gas', label: 'Book a refill', icon: Flame },
  { route: 'payments', label: 'Payments', icon: Wallet },
  { route: 'support', label: 'Support', icon: Headphones },
  { route: 'profile', label: 'Profile & connections', icon: Users },
] }];
const delivery = [{ label: 'My route', items: [
  { route: 'dashboard', label: 'Route overview', icon: LayoutDashboard },
  { route: 'assigned', label: 'Assigned deliveries', icon: Truck },
  { route: 'history', label: 'Delivery history', icon: Activity },
  { route: 'collections', label: 'My collections', icon: Wallet },
] }];

const useNavigation = create<{ compact: boolean; mobile: boolean; toggle: () => void; open: (mobile: boolean) => void }>(set => ({
  compact: false, mobile: false, toggle: () => set(state => ({ compact: !state.compact })), open: mobile => set({ mobile }),
}));

export function Console(props: Omit<Scope, 'branch'>) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } }));
  return <QueryClientProvider client={client}><Shell {...props}/></QueryClientProvider>;
}

function Shell({ profile, mode, section, detail, sub }: Omit<Scope, 'branch'>) {
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const navigation = useNavigation();
  const groups = mode === 'portal' ? portal : mode === 'delivery' ? delivery : agency;
  const active = groups.flatMap(group => group.items).find(item => item.route.split('/')[0] === section);
  const current = { profile, mode, section, detail, sub, branch };
  const dashboard = mode === 'app' && (section === 'dashboard' || section === 'reports') && profile.permissions.includes('dashboard:read');
  const booking = ['bookings', 'book-gas', 'deliveries', 'assigned', 'history'].includes(section) || section === 'dashboard';
  const root = '/' + mode + '/';
  const initials = profile.name.split(/\s+/).slice(0, 2).map(value => value[0]?.toUpperCase()).join('');
  return <div className={'shell' + (navigation.compact ? ' compact' : '')}>
    {navigation.mobile && <button className="nav-scrim" aria-label="Close navigation" onClick={() => navigation.open(false)}/>}
    <aside className={'sidebar' + (navigation.mobile ? ' mobile-open' : '')}>
      <Link className="brand" href={root + 'dashboard'} onClick={() => navigation.open(false)}><span className="brand-mark"><Flame size={21}/></span>
        <span className="nav-label">Cylinder Ops<small>AGENCY MANAGEMENT</small></span></Link>
      <div className="agency-card"><span className="agency-icon"><Building2 size={17}/></span><div className="nav-label"><strong>{profile.agency}</strong>
        <small>{mode === 'portal' ? 'Customer portal' : mode === 'delivery' ? 'Delivery portal' : 'Agency workspace'}</small></div></div>
      <nav aria-label="Workspace">{groups.map(group => {
        const items = group.items.filter(item => !('permission' in item) || profile.permissions.includes(item.permission as string));
        return items.length ? <div className="nav-group" key={group.label}><p className="nav-label">{group.label}</p>
          {items.map(({ route, label, icon: Icon }) => <Link key={route} href={root + route}
            onClick={() => navigation.open(false)} title={label} aria-current={route.split('/')[0] === section ? 'page' : undefined}>
            <Icon size={18} strokeWidth={1.8}/><span className="nav-label">{label}</span></Link>)}</div> : null;
      })}</nav>
      <div className="sidebar-footer"><span className="avatar">{initials}</span><div className="nav-label"><strong>{profile.name}</strong><small>{profile.roleName}</small></div></div>
    </aside>
    <div className="shell-body">
      <header className="topbar">
        <button className="icon-button desktop-toggle" aria-label="Toggle sidebar" onClick={navigation.toggle}><PanelLeftClose size={19}/></button>
        <button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={() => navigation.open(!navigation.mobile)}>{navigation.mobile ? <X size={21}/> : <Menu size={21}/>}</button>
        <div className="crumb"><span>Workspace</span><ChevronDown size={13}/><strong>{active?.label ?? 'Bookings'}</strong></div>
        <div className="top-actions">
          {profile.permissions.includes('booking:read') && <form className="global-search" action={root + (mode === 'delivery' ? 'assigned' : 'bookings')}>
            <Search size={16}/><input type="search" name="search" placeholder="Search bookings…" aria-label="Search bookings" value={search} onChange={event => setSearch(event.target.value)}/>
          </form>}
          {profile.branches.length > 0 && <label className="branch-select"><Building2 size={16}/><select aria-label="Active branch" value={branch} onChange={event => setBranch(event.target.value)}>
            <option value="">All branches</option>{profile.branches.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select><ChevronsUpDown size={13}/></label>}
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={async () => {
            try { await api('auth/logout', {}); window.location.assign(mode === 'app' ? '/login' : root + 'login'); }
            catch (error) { setSignOutError((error as Error).message); }
          }}><LogOut size={18}/></button>
        </div>
      </header>
      <main className="workspace" id="main">
        {signOutError && <p className="error" role="alert">{signOutError}</p>}
        {dashboard ? <Dashboard {...current}/> : booking ? <BookingWorkspace {...current}/> : <Records {...current}/>}
      </main>
      {mode !== 'app' && <nav className="bottom-nav" aria-label="Quick navigation">{groups[0].items.slice(0, 4).map(({ icon: Icon, label, route }) =>
        <Link href={root + route} key={route} aria-current={section === route ? 'page' : undefined}><Icon size={20}/><span>{label}</span></Link>)}</nav>}
    </div>
  </div>;
}


