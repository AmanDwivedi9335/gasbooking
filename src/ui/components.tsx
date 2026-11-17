'use client';
import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { human } from './api';

export function Status({ value }: { value: string }) {
  const green = ['DELIVERED', 'CLOSED', 'PAID', 'SENT', 'READ', 'RESOLVED', 'ACTIVE', 'CONFIRMED', 'APPROVED'];
  const red = ['CANCELLED', 'REJECTED', 'DEAD', 'FAILED_DELIVERY', 'PROVIDER_FAILED', 'URGENT'];
  const blue = ['ALLOCATED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'IN_PROGRESS'];
  const tone = green.includes(value) ? 'green' : red.includes(value) ? 'red' : blue.includes(value) ? 'blue' : ['PENDING_VALIDATION', 'ON_HOLD', 'PARTIAL', 'OPEN', 'PENDING'].includes(value) ? 'amber' : 'neutral';
  const text = ({ PENDING_VALIDATION: 'Pending validation', OUT_FOR_DELIVERY: 'Out for delivery',
    READY_FOR_DISPATCH: 'Ready for dispatch', FAILED_DELIVERY: 'Failed delivery' } as Record<string, string>)[value] ?? human(value);
  return <span className={'badge ' + tone}><i/>{text}</span>;
}

export function Heading({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function Empty({ label = 'No records found' }: { label?: string }) {
  return <div className="empty"><Inbox size={24}/><span>{label}</span></div>;
}

export function Loading() {
  return <div className="loading" role="status" aria-label="Loading records"><i/><i/><i/></div>;
}

export function Failure({ error }: { error: Error }) {
  return <div className="error" role="alert">{error.message}</div>;
}

export function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="modal-overlay"/>
    <Dialog.Content className="modal" aria-describedby={undefined}>
      <div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={19}/></Dialog.Close></div>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export type Column<T> = { label: string; view: (row: T) => React.ReactNode };
export function Table<T extends { id: string }>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  const definitions = useMemo<ColumnDef<T>[]>(() => columns.map(column => ({ id: column.label, header: column.label,
    cell: ({ row }) => column.view(row.original) })), [columns]);
  // TanStack Table provides the row and header models for every record grid.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns: definitions, getCoreRowModel: getCoreRowModel(), getRowId: row => row.id });
  if (!rows.length) return <Empty label={empty}/>;
  return <div className="table-scroll"><table>
    <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col">
      {flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function Pager({ count, previous, next }: { count: number; previous?: () => void; next?: () => void }) {
  return <div className="pager"><span>{count} {count === 1 ? 'record' : 'records'} shown</span><div>
    <button className="icon-button" aria-label="Previous page" disabled={!previous} onClick={previous}><ChevronLeft size={17}/></button>
    <button className="icon-button" aria-label="Next page" disabled={!next} onClick={next}><ChevronRight size={17}/></button>
  </div></div>;
}
