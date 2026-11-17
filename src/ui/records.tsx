'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowRight, Plus, Search, Settings2 } from 'lucide-react';
import { api, dateLabel, human, integer, rupees, today } from './api';
import { Empty, Failure, Heading, Loading, Pager, Status, Table, type Column } from './components';
import { branchField, choices, Form, Lookup, options, queryString, useRows, type Field } from './forms';
import { downloadCsv } from './dashboard';
import type { List, Row, Scope } from './types';

const text = (key: string, label: string): Column<Row> => ({ label, view: row => String(row[key] ?? '—') });
const value = (key: string, label: string): Column<Row> => ({ label, view: row => integer(Number(row[key] ?? 0)) });
const money = (key: string, label: string): Column<Row> => ({ label, view: row => rupees(Number(row[key] ?? 0)) });
const date = (key: string, label: string): Column<Row> => ({ label, view: row => dateLabel(String(row[key] ?? '')) });
const status = (key = 'status', label = 'Status'): Column<Row> => ({ label, view: row => <Status value={String(row[key])}/> });
const active: Column<Row> = { label: 'Status', view: row => <Status value={row.active ? 'ACTIVE' : 'INACTIVE'}/> };
const catalogColumns = [text('name', 'Product'), text('sku', 'SKU'), text('weightKg', 'Weight (kg)'), text('category', 'Category'), value('lowStock', 'Low stock threshold'), active];
const customerColumns = [text('name', 'Customer'), text('phone', 'Mobile'), text('email', 'Email'), text('category', 'Category'),
  { label: 'City', view: (row: Row) => (row.address as { city?: string })?.city ?? '—' }, active];
const connectionColumns = [text('consumerNumber', 'Consumer no.'), text('provider', 'Provider'), value('maxQuantity', 'Maximum quantity'),
  value('refillIntervalDays', 'Refill interval (days)'), active];

type Config = { title: string; description: string; path: string; columns: Column<Row>[]; action?: { id: string; label: string; permission: string }; search?: boolean };
const product: Config = { title: 'Products & pricing', description: 'Manage cylinder categories and effective-dated prices.', path: 'products', columns: catalogColumns,
  action: { id: 'product', label: 'Add product', permission: 'catalog:write' } };
const customers: Config = { title: 'Customers', description: 'Register and find customers by name, mobile or consumer number.', path: 'customers', columns: customerColumns,
  action: { id: 'customer', label: 'Add customer', permission: 'customer:write' }, search: true };
const connections: Config = { title: 'Connections', description: 'Manage authorized refill products and limits by connection.', path: 'connections', columns: connectionColumns,
  action: { id: 'connection', label: 'Add connection', permission: 'customer:write' } };
const payments: Config = { title: 'Payments', description: 'Review recorded cash and verified UPI collections.', path: 'payments', columns: [
  date('createdAt', 'Date'), money('amount', 'Amount'), text('mode', 'Method'), text('reference', 'Payment reference'), text('invoiceId', 'Invoice ID'),
] };
const invoices: Config = { title: 'Invoices', description: 'Review billed amounts and outstanding balances.', path: 'invoices', columns: [
  text('number', 'Invoice'), text('customerName', 'Customer'), text('productName', 'Product'),
  { label: 'Total', view: row => rupees((row.price as { total: number }).total) }, money('paid', 'Collected'), status(),
] };
const support: Config = { title: 'Support tickets', description: 'Track customer issues, due dates and resolutions.', path: 'complaints', columns: [
  text('subject', 'Subject'), text('category', 'Category'), status('priority', 'Priority'), status(), date('dueAt', 'Due'),
], action: { id: 'complaint', label: 'Create ticket', permission: 'support:write' } };
const communications: Config = { title: 'WhatsApp communications', description: 'Review notification attempts, provider identifiers and delivery status.', path: 'communications',
  columns: [text('event', 'Event'), text('entityId', 'Related record'), text('externalId', 'Provider ID'), date('createdAt', 'Requested'), status(), value('attempts', 'Attempts'), text('failure', 'Diagnostic')] };
const team: Config = { title: 'Staff accounts', description: 'Provision access for staff, drivers and customers.', path: 'staff',
  columns: [text('name', 'Name'), text('email', 'Email'), text('role', 'Role'), active],
  action: { id: 'staff', label: 'Add account', permission: 'staff:manage' } };
const audit: Config = { title: 'Audit history', description: 'Review recorded changes across the agency.', path: 'audit',
  columns: [date('createdAt', 'Date'), text('action', 'Action'), text('actorId', 'Actor'), text('entityId', 'Record')] };

export function Records(scope: Scope) {
  const { section, detail } = scope;
  const configs: Record<string, Config> = { customers, connections, products: product, payments, collections: payments, invoices, complaints: support, support, communications, staff: team };
  if (section === 'inventory') return <Inventory {...scope}/>;
  if (section === 'settings' && detail === 'integrations') return <IntegrationSettings/>;
  if (section === 'settings' && detail === 'audit-logs') return <Listing key={'audit:' + scope.branch} {...scope} config={audit}/>;
  if (section === 'settings') return <Settings/>;
  if (section === 'branches') return <Branches {...scope}/>;
  if (section === 'profile') return <><Listing {...scope} config={{ ...customers, title: 'My profile', description: 'Account and contact details.', action: undefined, search: false }}/>
    <Listing {...scope} config={{ ...connections, title: 'My connections', description: 'Registered LPG connections.', action: undefined }}/></>;
  if (!configs[section]) return <Empty label="This workspace is unavailable for your role"/>;
  return <Listing key={section + ':' + scope.branch} {...scope} config={configs[section]}/>;
}

function Listing({ config, ...scope }: Scope & { config: Config }) {
  const { profile, branch, detail } = scope;
  const [action, setAction] = useState(detail === 'new' ? config.action?.id ?? '' : '');
  const [target, setTarget] = useState<Row | undefined>();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState('');
  const [cursors, setCursors] = useState(['']);
  const cursor = cursors.at(-1);
  const params = queryString(branch, { ...(submitted ? { search: submitted } : {}), ...(filter ? { status: filter } : {}), ...(cursor ? { cursor } : {}) });
  const data = useQuery({ queryKey: ['records', config.path, params], queryFn: async () => {
    if (config.path === 'staff') return { rows: await api<Row[]>('staff?' + params), nextCursor: null };
    return api<List>(config.path + '?' + params);
  } });
  const select = (name: string, row?: Row) => { setTarget(row); setAction(name); };
  const can = (permission: string) => profile.permissions.includes(permission);
  const rows = data.data?.rows ?? [];
  let columns = config.columns;
  if (config.path === 'complaints' && can('support:manage')) columns = [...columns, { label: 'Action', view: row => <button className="text-button" onClick={() => select('complaintUpdate', row)}>Update <ArrowRight size={14}/></button> }];
  if (config.path === 'communications') columns = [...columns, { label: 'Action', view: row => row.status === 'DEAD' ?
    <button className="text-button" onClick={() => select('retry', row)}>Retry</button> : '—' }];
  if (config.path === 'invoices' && can('finance:collect')) columns = [...columns, { label: 'Action', view: row => row.status !== 'PAID' ?
    <button className="text-button" onClick={() => select('payment', row)}>Record payment</button> : '—' }];
  if (config.path === 'customers' && can('customer:write')) columns = [...columns, { label: 'Action', view: row =>
    <button className="text-button" onClick={() => select('customerEdit', row)}>Edit</button> }];
  return <>
    <Heading title={config.title} description={config.description} actions={<>
      {config.path === 'products' && can('catalog:write') && <button className="button" onClick={() => select('price')}>Add price</button>}
      {config.path === 'communications' && <Link className="button" href="/app/settings/integrations/winquly"><Settings2 size={16}/> Integration settings</Link>}
      {config.action && can(config.action.permission) && <button className="button primary" onClick={() => select(config.action!.id)}><Plus size={17}/> {config.action.label}</button>}
    </>}/>
    {config.path === 'complaints' && <div className="safety" role="note"><AlertTriangle size={20}/><div><strong>Suspected gas leak or immediate danger</strong>
      <p>Leave the affected area and contact emergency services from a safe location.{profile.emergencyContact && <> Agency emergency contact <a href={'tel:' + profile.emergencyContact}>{profile.emergencyContact}</a>.</>}</p></div></div>}
    <section className="card">
      {(config.search || config.path === 'communications' || config.path === 'payments') && <div className="table-tools">
        {config.search && <form className="list-search" onSubmit={event => { event.preventDefault(); setSubmitted(search.trim()); setCursors(['']); }}>
          <Search size={17}/><input type="search" placeholder="Name, mobile or consumer number…" aria-label="Search customers" value={search} onChange={event => setSearch(event.target.value)}/><button className="button">Search</button></form>}
        {config.path === 'communications' && <label className="filter">Status<select value={filter} onChange={event => { setFilter(event.target.value); setCursors(['']); }}>
          <option value="">All statuses</option>{['PENDING', 'RETRY', 'SENT', 'DELIVERED', 'READ', 'DEAD', 'PROVIDER_FAILED', 'SKIPPED'].map(item => <option key={item} value={item}>{human(item)}</option>)}</select></label>}
        {config.path === 'payments' && rows.length > 0 && <button className="button" onClick={() => downloadCsv('payments-page',
          [['Date', 'Amount (INR)', 'Mode', 'Reference'], ...rows.map(row => [String(row.createdAt), Number(row.amount) / 100, String(row.mode), String(row.reference ?? '')])])}>
          <ArrowDownToLine size={16}/> Export page</button>}
      </div>}
      {data.isPending ? <Loading/> : data.error ? <Failure error={data.error}/> : <>
        <Table rows={rows} columns={columns}/>
        <Pager count={rows.length} previous={cursors.length > 1 ? () => setCursors(cursors.slice(0, -1)) : undefined}
          next={data.data?.nextCursor ? () => setCursors([...cursors, data.data!.nextCursor!]) : undefined}/>
      </>}
    </section>
    {config.path === 'products' && <Prices {...scope}/>}
    {action && <RecordAction key={action + (target?.id ?? '')} {...scope} action={action} target={target} close={() => setAction('')}/>}
  </>;
}

function Prices({ branch }: Scope) {
  const prices = useRows('prices', branch);
  const products = useRows('products', branch);
  return <section className="card spaced"><div className="panel-header"><div><h2>Price list</h2><p>Effective dates use India Standard Time.</p></div></div>
    <Lookup sources={[prices, products]}><Table rows={prices.data?.rows ?? []} columns={[
      { label: 'Product', view: row => String(products.data?.rows.find(product => product.id === row.productId)?.name ?? row.productId) },
      money('unit', 'Unit price'), money('delivery', 'Delivery charge'), { label: 'Tax', view: row => Number(row.taxBps) / 100 + '%' }, date('effectiveAt', 'Effective from'),
    ]}/></Lookup></section>;
}

function Inventory(scope: Scope) {
  const { branch, profile, detail } = scope;
  const [action, setAction] = useState('');
  const products = useRows('products', branch);
  const warehouses = useRows('warehouses', branch);
  const counting = detail === 'reconciliation';
  const list = useRows(counting ? 'reconciliations' : detail === 'movements' ? 'movements' : 'balances', branch);
  const [target, setTarget] = useState<Row>();
  const canWrite = profile.permissions.includes('inventory:write');
  const nameBy = (source: List | undefined, id: unknown) => String(source?.rows.find(row => row.id === id)?.name ?? id);
  const columns: Column<Row>[] = [
    { label: 'Warehouse', view: row => nameBy(warehouses.data, row.warehouseId) },
    { label: 'Product', view: row => nameBy(products.data, row.productId) },
    ...(counting ? [text('reason', 'Count reference'), status(), date('createdAt', 'Submitted'),
      { label: 'Variance', view: (row: Row) => Object.entries(row.counted as Record<string, number>)
        .map(([key, amount]) => key + ' ' + (amount - (row.baseline as Record<string, number>)[key])).join(', ') },
      ...(profile.permissions.includes('inventory:approve') ? [{ label: 'Action', view: (row: Row) => row.status === 'PENDING' ?
        <button className="text-button" onClick={() => { setTarget(row); setAction('countReview'); }}>Review</button> : '—' }] : [])] :
      detail === 'movements' ? [text('action', 'Movement'), { label: 'Quantity change', view: (row: Row) => Object.entries((row.deltas ?? {}) as object).map(([key, amount]) => key + ' ' + amount).join(', ') },
      text('reason', 'Reason'), date('createdAt', 'Date')] :
      [{ label: 'Available', view: (row: Row) => <strong>{integer(Number(row.filled) - Number(row.reserved))}</strong> }, value('filled', 'Filled'),
        value('reserved', 'Reserved'), value('empty', 'Empty'), value('inTransit', 'In transit'), value('damaged', 'Damaged'), value('quarantined', 'Quarantined')]),
  ];
  return <>
    <Heading title={counting ? 'Stock reconciliation' : detail === 'movements' ? 'Stock movements' : 'Cylinder inventory'} description="Track physical balances, reservations and cylinder custody."
      actions={canWrite && (counting ? <button className="button primary" onClick={() => setAction('count')}><Plus size={17}/> Submit count</button> :
        <><button className="button" onClick={() => setAction('warehouse')}>Add warehouse</button><button className="button primary" onClick={() => setAction('stock')}><Plus size={17}/> Stock movement</button></>)}/>
    <div className="inline-links"><Link className={'button' + (!detail ? ' selected' : '')} href="/app/inventory">Stock balances</Link>
      <Link className={'button' + (detail === 'movements' ? ' selected' : '')} href="/app/inventory/movements">Movement ledger</Link>
      <Link className={'button' + (counting ? ' selected' : '')} href="/app/inventory/reconciliation">Stock reconciliation</Link></div>
    <section className="card"><Lookup sources={[list, products, warehouses]}><Table rows={list.data?.rows ?? []} columns={columns}/></Lookup></section>
    {action && <RecordAction {...scope} action={action} target={action === 'countReview' ? target : undefined} close={() => setAction('')}/>}
  </>;
}

function Branches(scope: Scope) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Scope['profile']['branches'][number]>();
  const canManage = scope.profile.permissions.includes('staff:manage');
  const routerRefresh = () => window.location.reload();
  return <><Heading title="Branches" description="Manage the locations assigned to your account."
    actions={canManage && <button className="button primary" onClick={() => setOpen(true)}><Plus size={17}/> Add branch</button>}/>
    <section className="card"><Table rows={scope.profile.branches} columns={[{ label: 'Branch', view: row => row.name }, { label: 'Code', view: row => row.code },
      { label: 'Delivery code', view: row => row.deliveryOtp ? 'Required' : 'Optional' },
      ...(canManage ? [{ label: 'Action', view: (row: Scope['profile']['branches'][number]) => <button className="text-button" onClick={() => setSelected(row)}>Settings</button> }] : [])]}/></section>
    {open && <Form title="Add branch" path="branches" close={() => setOpen(false)} success={routerRefresh} fields={[{ key: 'name', label: 'Branch name' }, { key: 'code', label: 'Branch code' }]}/>}
    {selected && <Form title={selected.name + ' delivery settings'} path={'branches/' + selected.id} close={() => setSelected(undefined)} success={routerRefresh}
      fields={[{ key: 'deliveryOtp', label: 'Require a customer portal code at delivery', kind: 'checkbox', initial: selected.deliveryOtp }]}/>}
  </>;
}

function Settings() {
  return <><Heading title="Agency settings" description="Manage messaging configuration and review changes."/>
    <section className="card settings-list">
      <Link href="/app/settings/integrations/winquly"><div><strong>Winquly integration</strong><p>Credentials, approved templates and diagnostics</p></div><ArrowRight size={18}/></Link>
      <Link href="/app/settings/audit-logs"><div><strong>Audit history</strong><p>Agency operational changes</p></div><ArrowRight size={18}/></Link>
    </section></>;
}

function IntegrationSettings() {
  const client = useQueryClient();
  const [result, setResult] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [testing, setTesting] = useState(false);
  const data = useQuery({ queryKey: ['winquly-settings'], queryFn: () => api<Row | null>('integrations/winquly') });
  const item = data.data;
  const fields: Field[] = [
    { key: 'environment', label: 'Environment', kind: 'select', options: choices(['SANDBOX', 'PRODUCTION']), initial: String(item?.environment ?? 'SANDBOX') },
    { key: 'apiBase', label: 'API base URL', initial: String(item?.apiBase ?? '') },
    { key: 'account', label: 'Business account', initial: String(item?.account ?? '') },
    { key: 'sender', label: 'Sender identifier', initial: String(item?.sender ?? '') },
    { key: 'credential', label: 'API credential', kind: 'password', required: false, placeholder: item?.hasCredential ? 'Credential stored' : undefined },
    { key: 'signingSecret', label: 'Webhook signing secret', kind: 'password', required: false, placeholder: item?.hasSigningSecret ? 'Secret stored' : undefined },
    { key: 'templates', label: 'Approved template mappings (JSON)', kind: 'textarea', required: false, initial: JSON.stringify(item?.templates ?? {}, null, 2) },
    { key: 'enabled', label: 'Enable notifications', kind: 'checkbox', initial: Boolean(item?.enabled) },
  ];
  return <><Heading title="Winquly integration" description="Configure the agency’s WhatsApp Business provider and approved notification templates."
    actions={item && <button className="button" disabled={testing} onClick={async () => {
      setError(null); setResult(''); setTesting(true);
      try { await api('integrations/winquly/test', {}); setResult('Authenticated diagnostic succeeded.'); await client.invalidateQueries(); }
      catch (failure) { setError(failure as Error); } finally { setTesting(false); }
    }}>{testing ? 'Testing…' : 'Test connection'}</button>}/>
    {error && <Failure error={error}/>}
    {result && <p className="success" role="status">{result}</p>}
    {data.isPending ? <Loading/> : data.error ? <Failure error={data.error}/> : <section className="card form-card">
      <Form title="Winquly settings" fields={fields} inline path="integrations/winquly" transform={value => {
        try { return { ...value, templates: JSON.parse(String(value.templates ?? '{}')) }; }
        catch { throw new Error('Template mappings must be valid JSON.'); }
      }}/>
      {item && <div className="integration-meta"><span>Last successful connection {dateLabel(String(item.lastSuccessAt ?? ''))}</span><span>Last webhook {dateLabel(String(item.lastWebhookAt ?? ''))}</span></div>}
    </section>}</>;
}

function RecordAction({ profile, branch, action, target, close }: Scope & { action: string; target?: Row; close: () => void }) {
  const [selected, setSelected] = useState(String(target?.branchId ?? (branch || profile.branches[0]?.id || '')));
  const needsCustomers = ['connection', 'staff', 'complaint'].includes(action) && profile.role !== 'CUSTOMER';
  const needsProducts = ['connection', 'price', 'stock', 'count'].includes(action);
  const needsWarehouses = ['stock', 'count'].includes(action);
  const clients = useRows('customers', selected, needsCustomers);
  const products = useRows('products', selected, needsProducts);
  const warehouses = useRows('warehouses', selected, needsWarehouses);
  const b = branchField(profile.branches, selected);
  const address = target?.address as Record<string, string> | undefined;
  const customerFields: Field[] = [
    { key: 'name', label: 'Full name', initial: target?.name as string }, { key: 'phone', label: 'Mobile number', placeholder: '+91…', initial: target?.phone as string },
    { key: 'alternatePhone', label: 'Alternate mobile', required: false, initial: target?.alternatePhone as string },
    { key: 'email', label: 'Email', kind: 'email', required: false, initial: target?.email as string },
    { key: 'category', label: 'Category', kind: 'select', options: choices(['DOMESTIC', 'COMMERCIAL']), initial: (target?.category ?? 'DOMESTIC') as string },
    { key: 'line', label: 'Street address', initial: address?.line }, { key: 'city', label: 'City', initial: address?.city },
    { key: 'state', label: 'State', required: false, initial: address?.state }, { key: 'pincode', label: 'PIN code', initial: address?.pincode },
    { key: 'landmark', label: 'Landmark', required: false, initial: address?.landmark },
    { key: 'instructions', label: 'Delivery instructions', kind: 'textarea', required: false, initial: address?.instructions },
    { key: 'whatsappOptIn', label: 'Customer opted in to WhatsApp updates', kind: 'checkbox', initial: Boolean(target?.whatsappOptInAt) },
  ];
  const customerPayload = ({ line, city, state, pincode, landmark, instructions, ...value }: Record<string, unknown>) =>
    ({ ...value, branchId: value.branchId ?? target?.branchId, address: { line, city, state, pincode, landmark, instructions } });
  const customerField: Field = { key: 'customerId', label: 'Customer', kind: 'select', options: options(clients.data?.rows ?? []) };
  const productField: Field = { key: 'productId', label: 'Product', kind: 'select', options: options(products.data?.rows ?? []) };
  const warehouseField: Field = { key: 'warehouseId', label: 'Warehouse', kind: 'select', options: options(warehouses.data?.rows ?? []) };
  const configs: Record<string, { title: string; path: string; fields: Field[]; transform?: (value: Record<string, unknown>) => object }> = {
    customer: { title: 'Register customer', path: 'customers', fields: [b, ...customerFields], transform: customerPayload },
    customerEdit: { title: 'Edit customer', path: 'customers/' + target?.id, fields: customerFields, transform: customerPayload },
    connection: { title: 'Register LPG connection', path: 'connections', fields: [b, customerField, { key: 'consumerNumber', label: 'Consumer number' },
      { key: 'provider', label: 'Provider reference', required: false }, { ...productField, key: 'productIds', label: 'Eligible products', kind: 'multiple' },
      { key: 'maxQuantity', label: 'Max quantity per refill', kind: 'number', min: 1, initial: 1 },
      { key: 'refillIntervalDays', label: 'Minimum days between refills', kind: 'number', min: 0, initial: 0 }] },
    product: { title: 'Add cylinder product', path: 'products', fields: [b, { key: 'name', label: 'Product name' }, { key: 'sku', label: 'SKU' },
      { key: 'weightKg', label: 'Weight (kg)', kind: 'number', step: '0.01', min: 0.01 },
      { key: 'category', label: 'Category', kind: 'select', options: choices(['DOMESTIC', 'COMMERCIAL']) },
      { key: 'lowStock', label: 'Low stock threshold', kind: 'number', min: 0, initial: 10 }] },
    price: { title: 'Add effective price', path: 'prices', fields: [b, productField, { key: 'unit', label: 'Unit price (₹)', kind: 'money', min: 0 },
      { key: 'taxBps', label: 'Tax (%)', kind: 'percent', initial: 0, min: 0 }, { key: 'delivery', label: 'Delivery charge (₹)', kind: 'money', initial: 0, min: 0 },
      { key: 'effectiveAt', label: 'Effective from', kind: 'date', initial: today() }] },
    warehouse: { title: 'Add warehouse', path: 'warehouses', fields: [b, { key: 'name', label: 'Warehouse name' }, { key: 'code', label: 'Warehouse code' }] },
    stock: { title: 'Record stock movement', path: 'inventory/movements', fields: [b, productField, warehouseField,
      { key: 'type', label: 'Movement type', kind: 'select', options: choices(['RECEIPT', 'TRANSFER']) },
      { key: 'bucket', label: 'Stock category', kind: 'select', options: choices(['filled', 'empty', 'damaged', 'quarantined']), initial: 'filled' },
      { key: 'quantity', label: 'Quantity', kind: 'number' }, { ...warehouseField, key: 'toWarehouseId', label: 'Destination (transfers)', required: false },
      { key: 'reason', label: 'Reason or reference', kind: 'textarea' }] },
    count: { title: 'Submit a warehouse count', path: 'inventory/reconciliation', fields: [b, productField, warehouseField,
      ...['filled', 'empty', 'damaged', 'quarantined'].map(key => ({ key, label: human(key) + ' counted', kind: 'number' as const, min: 0 })),
      { key: 'reason', label: 'Count reference', kind: 'textarea' }], transform: ({ filled, empty, damaged, quarantined, ...rest }) =>
      ({ ...rest, counted: { filled, empty, damaged, quarantined } }) },
    countReview: { title: 'Review stock count', path: 'inventory/reconciliation/' + target?.id, fields: [
      { key: 'decision', label: 'Decision', kind: 'select', options: choices(['APPROVED', 'REJECTED']) },
      { key: 'note', label: 'Review note', kind: 'textarea' },
    ] },
    complaint: { title: 'Create support ticket', path: 'complaints', fields: [b, ...(needsCustomers ? [customerField] : []), { key: 'subject', label: 'Subject' },
      { key: 'category', label: 'Category', kind: 'select', options: choices(['BOOKING', 'DELIVERY', 'BILLING', 'PAYMENT', 'CYLINDER', 'QUANTITY', 'CONNECTION', 'GENERAL', 'SAFETY']) },
      { key: 'description', label: 'Description', kind: 'textarea' }] },
    complaintUpdate: { title: 'Update ticket', path: 'complaints/' + target?.id, fields: [
      { key: 'status', label: 'Status', kind: 'select', options: choices(['OPEN', 'IN_PROGRESS', 'RESOLVED']) }, { key: 'note', label: 'Resolution or progress note', kind: 'textarea' }] },
    staff: { title: 'Add account', path: 'staff', fields: [b, { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', kind: 'email' },
      { key: 'role', label: 'Role', kind: 'select', options: choices(['BRANCH_MANAGER', 'OPERATOR', 'INVENTORY', 'SUPERVISOR', 'DRIVER', 'ACCOUNTS', 'CUSTOMER']) },
      { key: 'password', label: 'Initial password (14+ characters)', kind: 'password' }, { ...customerField, label: 'Linked customer (customer accounts)', required: false },
      { key: 'mfaSecret', label: 'Authenticator secret (base32)', kind: 'password', required: false }] },
    retry: { title: 'Retry WhatsApp notification', path: 'communications/' + target?.id + '/retry', fields: [] },
    payment: { title: 'Record collection', path: 'payments', fields: [
      { key: 'amount', label: 'Amount (₹)', kind: 'money', min: 0.01, initial: (((target?.price as { total?: number })?.total ?? 0) - Number(target?.paid ?? 0)) / 100 },
      { key: 'mode', label: 'Method', kind: 'select', options: choices(['CASH', 'UPI']), initial: 'CASH' },
      { key: 'reference', label: 'Verified UPI reference', required: false },
    ], transform: value => ({ ...value, invoiceId: target?.id }) },
  };
  const config = configs[action];
  if (!config) return null;
  const sources = [...(needsCustomers ? [clients] : []), ...(needsProducts ? [products] : []), ...(needsWarehouses ? [warehouses] : [])];
  return <Lookup sources={sources}><Form {...config} close={close} onValue={(key, value) => { if (key === 'branchId') setSelected(value); }}
    prefix={action === 'retry' ? <p>Requeue the dead-letter notification for processing.</p> : undefined}/></Lookup>;
}
