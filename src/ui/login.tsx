'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, Flame, LockKeyhole, PackageCheck, Truck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from './api';

const schema = z.object({ identifier: z.string().trim().toLowerCase().refine(value => value === 'admin' || z.email().safeParse(value).success,
  'Enter a user ID or email address.'), password: z.string().min(1, 'Enter your password.'),
  otp: z.union([z.literal(''), z.string().regex(/^\d{6}$/, 'Enter the six-digit code.')]),
  agency: z.union([z.literal(''), z.uuid('Enter the agency ID.')]) });

export function Login({ mode = 'app' }: { mode?: 'app' | 'portal' | 'delivery' }) {
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema), defaultValues: { identifier: '', password: '', otp: '', agency: '' },
  });
  return <main className="login-shell">
    <aside className="login-aside">
      <div className="brand"><span className="brand-mark"><Flame size={22}/></span><span>Cylinder Ops<small>LPG AGENCY MANAGEMENT</small></span></div>
      <div className="login-intro">
        <div className="login-emblem"><Flame size={46} strokeWidth={1.5}/></div>
        <h1>LPG operations,<br/>in one place.</h1>
        <p>Manage cylinder bookings, inventory, deliveries and collections across your agency.</p>
        <div className="login-features"><span><PackageCheck size={17}/> Bookings</span><span><Boxes size={17}/> Inventory</span><span><Truck size={17}/> Deliveries</span></div>
      </div>
      <div className="login-foot"><LockKeyhole size={15}/> Secure agency workspace</div>
    </aside>
    <section className="login-main">
      <div className="login-card">
        <div className="login-icon"><LockKeyhole size={23}/></div>
        <h2>{mode === 'portal' ? 'Customer sign in' : mode === 'delivery' ? 'Delivery agent sign in' : 'Sign in to your workspace'}</h2>
        <p>Enter your account details to continue.</p>
        <form onSubmit={handleSubmit(async values => {
          setError('');
          try {
            const { role } = await api<{ role: string }>('auth/login', { identifier: values.identifier, workspace: mode, password: values.password,
              otp: values.otp || undefined, agency: values.agency || undefined });
            window.location.assign(role === 'CUSTOMER' ? '/portal/dashboard' : role === 'DRIVER' ? '/delivery/dashboard' : '/app/dashboard');
          } catch (failure) { setError((failure as Error).message); setAdvanced(true); }
        })}>
          <label>User ID or email<input autoComplete="username" autoCapitalize="none" spellCheck={false} {...register('identifier')}/><small className="field-error">{errors.identifier?.message}</small></label>
          <label>Password<input type="password" autoComplete="current-password" placeholder="Enter your password" {...register('password')}/><small className="field-error">{errors.password?.message}</small></label>
          <button type="button" className="text-button login-options" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>Agency ID and authenticator options</button>
          {advanced && <><label>Agency ID <input {...register('agency')}/><small className="field-error">{errors.agency?.message}</small></label>
            <label>Authenticator code<input autoComplete="one-time-code" inputMode="numeric" {...register('otp')}/><small className="field-error">{errors.otp?.message}</small></label></>}
          {error && <div role="alert" className="error">{error}</div>}
          <button type="submit" className="button primary login-submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={17}/></button>
        </form>
        <nav className="login-links">{mode !== 'app' && <Link href="/login">Staff workspace</Link>}{mode !== 'portal' && <Link href="/portal/login">Customer portal</Link>}{mode !== 'delivery' && <Link href="/delivery/login">Delivery portal</Link>}</nav>
      </div>
    </section>
  </main>;
}
