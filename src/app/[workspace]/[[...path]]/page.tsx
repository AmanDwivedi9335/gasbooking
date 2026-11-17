import { notFound, redirect } from 'next/navigation';
import { currentActor, workspace } from '@/server/auth';
import { allowed, permissions, roleNames } from '@/server/policy';
import { Login } from '@/ui/login';
import { Console } from '@/ui/console';

const staff = new Set(['dashboard', 'bookings', 'customers', 'connections', 'products', 'inventory', 'deliveries',
  'payments', 'invoices', 'complaints', 'communications', 'reports', 'staff', 'branches', 'settings']);
const customer = new Set(['dashboard', 'book-gas', 'bookings', 'payments', 'support', 'profile']);
const delivery = new Set(['dashboard', 'assigned', 'collections', 'history']);

export default async function Workspace({ params }: { params: Promise<{ workspace: string; path?: string[] }> }) {
  const { workspace: mode, path = [] } = await params;
  if (mode !== 'app' && mode !== 'portal' && mode !== 'delivery') notFound();
  const [section = 'dashboard', detail, sub] = path;
  if (section === 'login') return <Login mode={mode} />;
  const valid = (mode === 'app' ? staff : mode === 'portal' ? customer : delivery).has(section);
  const deliveryDetail = mode === 'delivery' && /^[0-9a-f-]{36}$/i.test(section);
  if (!valid && !deliveryDetail) notFound();
  const actor = await currentActor();
  if (!actor) redirect(mode === 'app' ? '/login' : '/' + mode + '/login');
  const home = actor.role === 'CUSTOMER' ? 'portal' : actor.role === 'DRIVER' ? 'delivery' : 'app';
  if (mode !== home) redirect('/' + home + '/dashboard');
  const details = await workspace(actor);
  return <Console mode={mode} section={deliveryDetail ? 'assigned' : section} detail={deliveryDetail ? section : detail}
    sub={sub} profile={{ name: actor.name, role: actor.role, roleName: roleNames[actor.role], permissions: permissions.filter(permission => allowed(actor, permission)), ...details }} />;
}
