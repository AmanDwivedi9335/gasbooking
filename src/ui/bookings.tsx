'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ClipboardList, MapPin, Phone, Plus, Printer, Search, Truck } from 'lucide-react';
import { api, dateLabel, human, rupees } from './api';
import { Empty, Failure, Heading, Loading, Pager, Status, Table } from './components';
import { branchField, choices, Form, Lookup, options, queryString, useRows, type Field } from './forms';
import type { Booking, Row, Scope } from './types';

const tabs = ['ALL', 'PENDING_VALIDATION', 'CONFIRMED', 'ALLOCATED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'CLOSED', 'CANCELLED', 'REJECTED', 'ON_HOLD'];
type Detail = { booking: Booking; phone?: string; deliveryCode?: string; events: { id: string; to: string; reason?: string; createdAt: string }[];
  invoice?: { id: string; number: string; paid: number; status: string }; proof?: { recipient: string; empties: number; delivered: number; reference?: string } };

export function BookingWorkspace(scope: Scope) {
  if (scope.detail === 'new' || scope.section === 'book-gas') return <NewBooking {...scope}/>;
  if (scope.detail && scope.detail !== 'dispatch' && scope.detail !== 'agents') return <BookingDetail {...scope} id={scope.detail}/>;
  return <BookingList key={[scope.branch, scope.section, scope.detail].join(':')} {...scope}/>;
}

function BookingList({ mode, profile, section, branch, detail }: Scope) {
  const searchParams = useSearchParams();
  const initial = section === 'history' ? 'DELIVERED' : detail === 'dispatch' ? 'READY_FOR_DISPATCH' : section === 'deliveries' ? 'OUT_FOR_DELIVERY' : 'ALL';
  const [status, setStatus] = useState(initial);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [submitted, setSubmitted] = useState(searchParams.get('search') ?? '');
  const [cursors, setCursors] = useState(['']);
  const cursor = cursors.at(-1);
  const params = queryString(branch, { ...(status !== 'ALL' ? { status } : {}), ...(submitted ? { search: submitted } : {}), ...(cursor ? { cursor } : {}) });
  const query = useQuery({ queryKey: ['bookings', params], queryFn: () => api<{ rows: Booking[]; nextCursor: string | null }>('bookings?' + params) });
  const root = mode === 'delivery' ? '/delivery/' : '/' + mode + '/bookings/';
  const title = mode === 'delivery' ? section === 'history' ? 'Delivery history' : 'Assigned deliveries' :
    section === 'deliveries' ? 'Delivery operations' : mode === 'portal' ? 'My bookings' : 'Bookings';
  const rows = query.data?.rows ?? [];
  return <>
    <Heading title={title} description={mode === 'delivery' ? 'Review your stops, record delivery outcomes and reconcile collections.' : 'Find bookings and follow each order through fulfillment.'}
      actions={profile.permissions.includes('booking:create') && <Link className="button primary" href={mode === 'portal' ? '/portal/book-gas' : '/app/bookings/new'}><Plus size={17}/> {mode === 'portal' ? 'Book a refill' : 'New booking'}</Link>}/>
    <section className="card">
      <div className="table-tools"><form className="list-search" onSubmit={event => { event.preventDefault(); setSubmitted(search.trim()); setCursors(['']); }}>
        <Search size={17}/><input aria-label="Filter bookings" placeholder="Booking number or customer…" type="search" value={search} onChange={event => setSearch(event.target.value)}/>
        <button className="button" type="submit">Search</button></form>
        <label className="filter">Status<select value={status} onChange={event => { setStatus(event.target.value); setCursors(['']); }}>
          {tabs.map(value => <option value={value} key={value}>{value === 'ALL' ? 'All statuses' : human(value)}</option>)}</select></label>
      </div>
      {query.isPending ? <Loading/> : query.error ? <Failure error={query.error}/> : mode === 'delivery' && rows.length ?
        <div className="stop-list">{rows.map(row => <Link className="stop" href={root + row.id} key={row.id}>
          <span className="metric-icon blue"><Truck size={18}/></span><div><strong>{row.customerName}</strong><p>{row.deliveryAddress.line}, {row.deliveryAddress.city}</p>
            <small>{row.productName} × {row.quantity} · {rupees(row.price.total)}</small></div><Status value={row.status}/><ArrowRight size={16}/></Link>)}</div> :
        <Table rows={rows} empty="No bookings match these filters" columns={[
          { label: 'Booking', view: row => <Link className="cell-link" href={root + row.id}>{row.number}</Link> },
          { label: 'Customer', view: row => row.customerName }, { label: 'Product', view: row => row.productName },
          { label: 'Qty', view: row => row.quantity }, { label: 'Status', view: row => <Status value={row.status}/> },
          { label: 'Booked', view: row => dateLabel(row.createdAt) }, { label: 'Amount', view: row => rupees(row.price.total) },
        ]}/>}
      {query.data && <Pager count={rows.length} previous={cursors.length > 1 ? () => setCursors(cursors.slice(0, -1)) : undefined}
        next={query.data.nextCursor ? () => setCursors([...cursors, query.data!.nextCursor!]) : undefined}/>}
    </section>
  </>;
}

function NewBooking({ profile, mode, branch }: Scope) {
  const router = useRouter();
  const [selected, setSelected] = useState(branch || profile.branches[0]?.id || '');
  const [connection, setConnection] = useState('');
  const links = useRows('connections', selected);
  const products = useRows('products', selected);
  const allowed = (links.data?.rows.find(row => row.id === connection)?.productIds ?? []) as string[];
  const fields: Field[] = [
    branchField(profile.branches, selected),
    { key: 'connectionId', label: 'Connection', kind: 'select', options: options(links.data?.rows.filter(row => row.active) ?? [], 'consumerNumber') },
    { key: 'productId', label: 'Cylinder product', kind: 'select', options: options(products.data?.rows.filter(row => allowed.includes(row.id)) ?? []) },
    { key: 'quantity', label: 'Quantity', kind: 'number', min: 1, initial: 1 },
    { key: 'preferredDate', label: 'Preferred delivery date', kind: 'date', required: false },
    ...(mode === 'app' ? [{ key: 'source', label: 'Booking source', kind: 'select' as const, options: [{ id: 'PORTAL', label: 'Staff portal' }, { id: 'PHONE', label: 'Telephone' }], initial: 'PORTAL' }] : []),
    { key: 'notes', label: 'Notes', kind: 'textarea', required: false },
  ];
  return <>
    <Heading title={mode === 'portal' ? 'Book a refill' : 'New booking'} description="Select a connection and eligible cylinder product. The effective price is applied when the booking is created."/>
    {!profile.permissions.includes('booking:create') ? <Empty label="Your role cannot create bookings"/> : <section className="card form-card">
      <Lookup sources={[links, products]}>{!links.data?.rows.length ? <Empty label="No connections found. Register an eligible connection first."/> :
        <Form title="Booking details" fields={fields} inline path="bookings" label="Create booking" onValue={(key, value) => {
          if (key === 'branchId') { setSelected(value); setConnection(''); }
          if (key === 'connectionId') setConnection(value);
        }} success={row => router.push('/' + mode + '/bookings/' + row.id)}/>}</Lookup>
    </section>}
  </>;
}

const transitions: Record<string, { key: string; label: string; permission?: string }[]> = {
  PENDING_VALIDATION: [{ key: 'confirm', label: 'Confirm booking' }, { key: 'hold', label: 'Put on hold' }, { key: 'reject', label: 'Reject' }, { key: 'cancel', label: 'Cancel booking' }],
  CONFIRMED: [{ key: 'allocate', label: 'Allocate stock', permission: 'inventory:write' }, { key: 'hold', label: 'Put on hold' }, { key: 'cancel', label: 'Cancel booking' }],
  ALLOCATED: [{ key: 'assign', label: 'Assign driver', permission: 'delivery:assign' }, { key: 'cancel', label: 'Cancel booking' }],
  READY_FOR_DISPATCH: [{ key: 'dispatch', label: 'Dispatch', permission: 'delivery:assign' }, { key: 'cancel', label: 'Cancel booking' }],
  OUT_FOR_DELIVERY: [{ key: 'complete', label: 'Record delivery', permission: 'delivery:execute' }, { key: 'fail', label: 'Record failed delivery', permission: 'delivery:execute' }],
  FAILED_DELIVERY: [{ key: 'confirm', label: 'Confirm retry' }, { key: 'cancel', label: 'Cancel booking' }],
  ON_HOLD: [{ key: 'resume', label: 'Resume booking' }, { key: 'cancel', label: 'Cancel booking' }],
  DELIVERED: [{ key: 'close', label: 'Close booking' }],
};

function BookingDetail({ id, mode, profile }: Scope & { id: string }) {
  const [action, setAction] = useState('');
  const query = useQuery({ queryKey: ['booking', id], queryFn: () => api<Detail>('bookings/' + id) });
  if (query.isPending) return <Loading/>;
  if (query.error) return <Failure error={query.error}/>;
  const { booking, events, invoice, proof, phone, deliveryCode } = query.data;
  const address = booking.deliveryAddress;
  const actions = (transitions[booking.status] ?? []).filter(item => profile.permissions.includes(item.permission ?? 'booking:manage'));
  const back = mode === 'delivery' ? '/delivery/assigned' : '/' + mode + '/bookings';
  return <>
    <Link href={back} className="text-button back-link"><ArrowLeft size={16}/> {mode === 'delivery' ? 'Assigned deliveries' : 'Bookings'}</Link>
    <Heading title={booking.number} description={booking.productName + ' × ' + booking.quantity + ' · ' + booking.customerName}
      actions={<><Status value={booking.status}/><button className="button" onClick={() => window.print()}><Printer size={16}/> Print</button></>}/>
    {deliveryCode && <div className="success delivery-code" role="status"><strong>Delivery code {deliveryCode}</strong><p>Share this code with the delivery agent when you receive your cylinder.</p></div>}
    {actions.length > 0 && <div className="action-strip">{actions.map((item, index) => <button className={'button' + (index === 0 ? ' primary' : '')}
      key={item.key} onClick={() => setAction(item.key)}>{item.label}</button>)}</div>}
    <div className="detail-grid">
      <section className="card"><div className="panel-header"><h2>Booking details</h2><ClipboardList size={19}/></div>
        <dl className="details"><dt>Customer</dt><dd>{booking.customerName}</dd><dt>Product</dt><dd>{booking.productName} × {booking.quantity}</dd>
          <dt>Created</dt><dd>{dateLabel(booking.createdAt)}</dd><dt>Source</dt><dd>{human(booking.source)}</dd>
          <dt>Preferred date</dt><dd>{booking.preferredDate ? dateLabel(booking.preferredDate) : '—'}</dd>
          <dt>Delivery agent</dt><dd>{booking.agentName ?? 'Unassigned'}</dd>{booking.notes && <><dt>Notes</dt><dd>{booking.notes}</dd></>}</dl>
      </section>
      <section className="card"><div className="panel-header"><h2>Delivery address</h2><MapPin size={19}/></div>
        <div className="panel-body address"><strong>{address.line}</strong><p>{address.city}, {address.state ? address.state + ' ' : ''}{address.pincode}</p>
          {address.landmark && <p>{address.landmark}</p>}{address.instructions && <p>{address.instructions}</p>}
          <div>{phone && <a className="button" href={'tel:' + phone}><Phone size={15}/> Call customer</a>}
            {mode === 'delivery' && <a className="button" target="_blank" rel="noreferrer" href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([address.line, address.city, address.pincode].join(', '))}><MapPin size={15}/> Directions</a>}</div>
          {proof && <p>Received by {proof.recipient} · {proof.delivered} delivered · {proof.empties} empties</p>}
        </div>
      </section>
      <section className="card"><div className="panel-header"><h2>{invoice ? 'Invoice ' + invoice.number : 'Booking amount'}</h2>{invoice && <Status value={invoice.status}/>}</div>
        <dl className="details"><dt>Subtotal</dt><dd>{rupees(booking.price.subtotal)}</dd><dt>Tax</dt><dd>{rupees(booking.price.tax)}</dd>
          <dt>Delivery</dt><dd>{rupees(booking.price.delivery)}</dd><dt>Total</dt><dd><strong>{rupees(booking.price.total)}</strong></dd>
          {invoice && <><dt>Outstanding</dt><dd>{rupees(booking.price.total - invoice.paid)}</dd></>}</dl>
        {invoice && invoice.status !== 'PAID' && profile.permissions.includes('finance:collect') && <div className="panel-body"><button className="button primary" onClick={() => setAction('payment')}>Record payment</button></div>}
      </section>
      <section className="card"><div className="panel-header"><h2>Booking timeline</h2></div>
        <ol className="timeline">{events.map(event => <li key={event.id}><Status value={event.to}/><time>{dateLabel(event.createdAt)}</time>{event.reason && <p>{event.reason}</p>}</li>)}</ol>
      </section>
    </div>
    {action && <BookingAction action={action} data={query.data} close={() => setAction('')}/>}
  </>;
}

function BookingAction({ action, data, close }: { action: string; data: Detail; close: () => void }) {
  const { booking, invoice } = data;
  const warehouses = useRows('warehouses', booking.branchId, action === 'allocate');
  const agents = useQuery({ queryKey: ['agents', booking.branchId], enabled: action === 'assign',
    queryFn: () => api<Row[]>('deliveries/agents?' + queryString(booking.branchId)) });
  const fields: Field[] = [];
  if (['cancel', 'hold', 'reject', 'fail'].includes(action)) fields.push({ key: 'reason', label: 'Reason', kind: 'textarea' });
  if (action === 'allocate') fields.push({ key: 'warehouseId', label: 'Warehouse', kind: 'select', options: options(warehouses.data?.rows ?? []) });
  if (action === 'assign') fields.push({ key: 'agentId', label: 'Delivery agent', kind: 'select', options: options(agents.data ?? []) });
  if (action === 'complete') fields.push({ key: 'recipient', label: 'Recipient' }, { key: 'delivered', label: 'Filled cylinders delivered', kind: 'number', initial: booking.quantity },
    { key: 'empties', label: 'Empty cylinders collected', kind: 'number', min: 0 }, { key: 'reference', label: 'Proof reference', required: false });
  if (action === 'complete' && booking.deliveryOtpRequired) fields.push({ key: 'otp', label: 'Delivery code', kind: 'password' });
  if (action === 'fail') fields.push({ key: 'returned', label: 'Filled cylinders physically returned', kind: 'number', min: 0 });
  if (action === 'payment') fields.push({ key: 'amount', label: 'Amount (₹)', kind: 'money', min: 0.01, initial: (booking.price.total - (invoice?.paid ?? 0)) / 100 },
    { key: 'mode', label: 'Payment mode', kind: 'select', options: choices(['CASH', 'UPI']), initial: 'CASH' },
    { key: 'reference', label: 'Verified UPI reference', required: false });
  return <Lookup sources={action === 'allocate' ? [warehouses] : action === 'assign' ? [agents] : []}>
    <Form title={action === 'payment' ? 'Record payment' : (transitions[booking.status]?.find(item => item.key === action)?.label ?? human(action))}
      fields={fields} close={close} path={action === 'payment' ? 'payments' : 'bookings/' + booking.id + '/' + action} label="Confirm"
      transform={value => action === 'payment' ? { ...value, invoiceId: invoice?.id } : value}
      prefix={!fields.length ? <p>Confirm this action for {booking.number}.</p> : undefined}/>
  </Lookup>;
}

