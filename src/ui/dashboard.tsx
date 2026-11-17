'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownToLine, ArrowRight, CalendarDays, ClipboardList, Package, Plus, Truck, Wallet } from 'lucide-react';
import { api, dateLabel, human, integer, rupees, today } from './api';
import { Empty, Failure, Heading, Loading, Status, Table } from './components';
import type { Booking, Scope } from './types';

type DashboardData = { customers: number; connections: number; openInvoices: number; failures: number; counts: Record<string, number>;
  collections: number; total: number; trend: { date: string; bookings: number; delivered: number }[];
  recent: Booking[]; delivery: { name: string; completed: number; failed: number; averageHours: number | null }[];
  stock: { id: string; name: string; available: number; lowStock: number; empty: number; reserved: number; inTransit: number }[] };

const flow = [
  { label: 'Pending validation', status: 'PENDING_VALIDATION', color: '#d8ab44' },
  { label: 'Confirmed', status: 'CONFIRMED', color: '#56a48b' },
  { label: 'Allocated', status: 'ALLOCATED', color: '#7497df' },
  { label: 'Ready for dispatch', status: 'READY_FOR_DISPATCH', color: '#8276c1' },
  { label: 'Out for delivery', status: 'OUT_FOR_DELIVERY', color: '#4b81d4' },
  { label: 'Delivered', status: 'DELIVERED', color: '#11866b' },
];

export function downloadCsv(name: string, records: (string | number)[][]) {
  const safe = (value: string | number) => {
    const text = String(value);
    return '"' + (/^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const file = new Blob([records.map(row => row.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = href;
  link.download = name + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function Dashboard({ profile, branch, section }: Scope) {
  const [range, setRange] = useState({ from: today(-6), to: today() });
  const [custom, setCustom] = useState(false);
  const params = new URLSearchParams({ from: range.from, to: range.to, ...(branch ? { branchId: branch } : {}) });
  const data = useQuery({ queryKey: ['dashboard', params.toString()], queryFn: () => api<DashboardData>('reports/dashboard?' + params) });
  const value = data.data;
  const report = section === 'reports';
  const lowStock = value?.stock.filter(row => row.available <= row.lowStock).length ?? 0;
  const metrics = value ? [
    { label: 'Total bookings', value: integer(value.total), detail: integer(value.counts.PENDING_VALIDATION ?? 0) + ' pending validation', icon: ClipboardList, color: 'teal' },
    { label: 'Delivered', value: integer((value.counts.DELIVERED ?? 0) + (value.counts.CLOSED ?? 0)), detail: integer(value.counts.OUT_FOR_DELIVERY ?? 0) + ' out for delivery', icon: Truck, color: 'blue' },
    { label: 'Collections', value: rupees(value.collections), detail: integer(value.openInvoices) + ' open invoices', icon: Wallet, color: 'violet' },
    { label: 'Available stock', value: integer(value.stock.reduce((sum, row) => sum + row.available, 0)), detail: integer(lowStock) + (lowStock === 1 ? ' product at low stock' : ' products at low stock'), icon: Package, color: 'amber' },
  ] : [];
  return <>
    <Heading title={report ? 'Operations reports' : 'Operations dashboard'}
      description={report ? 'Booking, delivery, collection and stock activity by branch.' : 'Track bookings, deliveries, collections and cylinder stock across your agency.'}
      actions={<>
        <label className="button date-preset"><CalendarDays size={16}/><select aria-label="Date range" onChange={event => {
          setCustom(event.target.value === 'custom');
          if (event.target.value !== 'custom') setRange({ from: today(1 - Number(event.target.value)), to: today() });
        }} defaultValue="7"><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom dates</option></select></label>
        {report && value && <button className="button" onClick={() => downloadCsv('booking-activity', [['Date', 'Bookings', 'Delivered'],
          ...value.trend.map(row => [row.date, row.bookings, row.delivered])])}><ArrowDownToLine size={16}/> Export CSV</button>}
        {!report && profile.permissions.includes('booking:create') && <Link className="button primary" href="/app/bookings/new"><Plus size={17}/> New booking</Link>}
      </>}/>
    {custom && <div className="date-fields"><label>From<input type="date" value={range.from} onChange={event => event.target.value && setRange({ ...range, from: event.target.value })}/></label>
      <label>To<input type="date" value={range.to} onChange={event => event.target.value && setRange({ ...range, to: event.target.value })}/></label></div>}
    {data.isPending ? <Loading/> : data.error ? <Failure error={data.error}/> : value && <>
      <div className="metrics">{metrics.map(({ label, value, detail, icon: Icon, color }) => <section className="card metric" key={label}>
        <div><p>{label}</p><span className={'metric-icon ' + color}><Icon size={18}/></span></div>
        <strong>{value}</strong><small>{detail}</small>
      </section>)}</div>
      <div className="chart-grid">
        <section className="card chart-card">
          <div className="panel-header"><div><h2>Booking activity</h2><p>Bookings created and fulfilled by booking date</p></div>
            <div className="legend"><span><i/>Bookings</span><span><i/>Delivered</span></div></div>
          <div className="chart" aria-label="Booking and delivery trend">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={value.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs><linearGradient id="bookings" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a9479" stopOpacity={0.21}/><stop offset="100%" stopColor="#1a9479" stopOpacity={0.025}/></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#e5eaec" strokeDasharray="4 4"/>
                <XAxis dataKey="date" tickFormatter={dateLabel} axisLine={false} tickLine={false} tick={{ fill: '#697786', fontSize: 11 }} minTickGap={26}/>
                <YAxis allowDecimals={false} width={32} domain={[0, (max: number) => Math.max(max, 4)]} axisLine={false} tickLine={false} tick={{ fill: '#697786', fontSize: 11 }}/>
                <Tooltip labelFormatter={label => dateLabel(String(label))}/>
                <Area type="monotone" dataKey="bookings" name="Bookings" stroke="#11866b" strokeWidth={2.5} fill="url(#bookings)" isAnimationActive={false}/>
                <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#7895d3" strokeWidth={2} fill="transparent" isAnimationActive={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card fulfillment">
          <div className="panel-header"><div><h2>Booking pipeline</h2><p>Current status of bookings in this period</p></div></div>
          <div className="pipeline">{flow.map(step => {
            const count = (value.counts[step.status] ?? 0) + (step.status === 'DELIVERED' ? value.counts.CLOSED ?? 0 : 0);
            return <div key={step.status}><div><span><i style={{ background: step.color }}/>{step.label}</span><strong>{count}</strong></div>
              <div className="progress"><b style={{ width: (value.total ? 100 * count / value.total : 0) + '%', background: step.color }}/></div></div>;
          })}</div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="card recent">
          <div className="panel-header"><div><h2>Recent bookings</h2><p>Latest bookings in the selected period</p></div>
            <Link className="text-button" href="/app/bookings">View bookings <ArrowRight size={15}/></Link></div>
          <Table rows={value.recent} empty="No bookings in this period" columns={[
            { label: 'Booking', view: row => <Link className="cell-link" href={'/app/bookings/' + row.id}>{row.number}</Link> },
            { label: 'Customer', view: row => row.customerName }, { label: 'Product', view: row => row.productName },
            { label: 'Status', view: row => <Status value={row.status}/> }, { label: 'Amount', view: row => rupees(row.price.total) },
          ]}/>
        </section>
        <section className="card stock-card">
          <div className="panel-header"><div><h2>Stock overview</h2><p>Available filled cylinders</p></div>
            {profile.permissions.includes('inventory:read') && <Link className="text-button" href="/app/inventory">Inventory <ArrowRight size={15}/></Link>}</div>
          {value.stock.length ? <ul>{value.stock.slice(0, 5).map(stock => <li key={stock.id}><span className="stock-icon"><Package size={17}/></span><div><strong>{stock.name}</strong><small>{stock.available <= stock.lowStock ? 'Low stock' : integer(stock.reserved) + ' reserved'}</small></div>
            <b>{integer(stock.available)}</b></li>)}</ul> : <Empty label="No products configured"/>}
        </section>
      </div>
      <div className="summary-strip">
        <span><strong>{integer(value.customers)}</strong> active customers</span><span><strong>{integer(value.connections)}</strong> active connections</span>
        <span><strong>{integer(value.failures)}</strong> dead-letter notifications</span>
        {['FAILED_DELIVERY', 'CANCELLED', 'ON_HOLD'].map(status => <span key={status}><strong>{value.counts[status] ?? 0}</strong> {human(status).toLowerCase()}</span>)}
      </div>
      {report && <section className="card"><div className="panel-header"><h2>Delivery performance</h2></div><Table rows={value.delivery.map((row, index) => ({ ...row, id: String(index) }))}
        columns={[{ label: 'Agent', view: row => row.name }, { label: 'Completed', view: row => row.completed },
          { label: 'Failed', view: row => row.failed }, { label: 'Average fulfillment', view: row => row.averageHours === null ? '—' : row.averageHours.toFixed(1) + ' hours' }]}/></section>}
    </>}
  </>;
}
