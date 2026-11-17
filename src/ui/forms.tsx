'use client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Failure, Loading, Modal } from './components';
import type { List, Row } from './types';

export type Field = { key: string; label: string; kind?: 'number' | 'money' | 'percent' | 'date' | 'email' | 'password' | 'checkbox' | 'textarea' | 'select' | 'multiple';
  options?: { id: string; label: string }[]; required?: boolean; initial?: string | number | boolean; placeholder?: string; min?: number; step?: string };
export const options = (rows: Row[], key = 'name') => rows.map(row => ({ id: row.id, label: String(row[key] ?? row.id) }));
export const choices = (values: string[]) => values.map(value => ({ id: value, label: value.replaceAll('_', ' ') }));
export const queryString = (branch: string, extra: Record<string, string> = {}) => new URLSearchParams({ ...(branch ? { branchId: branch } : {}), ...extra }).toString();
export const branchField = (branches: { id: string; name: string }[], branch: string): Field => ({
  key: 'branchId', label: 'Branch', kind: 'select', options: branches.map(row => ({ id: row.id, label: row.name })),
  initial: branch || branches[0]?.id,
});

export function useRows(path: string, branch: string, enabled = true) {
  return useQuery({ queryKey: ['lookup', path, branch], enabled, queryFn: () => api<List>(path + '?' + queryString(branch, { limit: '100' })) });
}

function parse(field: Field, data: FormData) {
  if (field.kind === 'multiple') return data.getAll(field.key);
  const value = data.get(field.key);
  if (field.kind === 'checkbox') return value === 'on';
  if (!value) return undefined;
  if (field.kind === 'number') return Number(value);
  if (field.kind === 'money' || field.kind === 'percent') return Math.round(Number(value) * 100);
  return value;
}

export function Form({ title, fields, close, path, transform, label = 'Save', success, inline = false, prefix, onValue }:
  { title: string; fields: Field[]; close?: () => void; path: string; transform?: (value: Record<string, unknown>) => object;
    label?: string; success?: (value: Row) => void; inline?: boolean; prefix?: React.ReactNode; onValue?: (key: string, value: string) => void }) {
  const client = useQueryClient();
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const content = <form className="record-form" onSubmit={async event => {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    const parsed = Object.fromEntries(fields.map(field => [field.key, parse(field, data)]));
    busy.current = true;
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      key.current ??= crypto.randomUUID();
      const result = await api<Row>(path, transform?.(parsed) ?? parsed, key.current);
      await client.invalidateQueries();
      key.current = null;
      setSaved(true);
      success?.(result);
      close?.();
    } catch (failure) { setError(failure as Error); }
    finally { setPending(false); busy.current = false; }
  }} onChange={event => {
    key.current = null;
    const field: EventTarget = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) onValue?.(field.name, field.value);
  }}>
    {prefix}
    <div className="fields">{fields.map(field => {
      const required = field.required !== false;
      const initial = typeof field.initial === 'boolean' ? undefined : field.initial;
      const id = 'field-' + field.key;
      return field.kind === 'checkbox' ? <label key={field.key} className="check"><input type="checkbox" name={field.key} defaultChecked={Boolean(field.initial)}/>{field.label}</label>
        : <label key={field.key} htmlFor={id} className={field.kind === 'textarea' ? 'full-field' : undefined}>{field.label}
          {field.kind === 'select' || field.kind === 'multiple' ? <select id={id} name={field.key} aria-label={field.label} required={required} multiple={field.kind === 'multiple'}
            defaultValue={field.kind === 'multiple' ? [] : initial ?? ''}>
            {field.kind === 'select' && <option value="">Select {field.label.toLowerCase()}</option>}
            {field.options?.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
          </select> : field.kind === 'textarea' ? <textarea id={id} name={field.key} required={required} defaultValue={initial} rows={3} maxLength={1500}/>
          : <input id={id} name={field.key} required={required} placeholder={field.placeholder}
            type={field.kind === 'money' || field.kind === 'percent' ? 'number' : field.kind ?? 'text'} defaultValue={initial} min={field.min}
            step={field.step ?? (field.kind === 'money' || field.kind === 'percent' ? '0.01' : undefined)} autoComplete={field.kind === 'password' ? 'new-password' : undefined}/>}
        </label>;
    })}</div>
    {error && <Failure error={error}/>}
    {saved && inline && <p className="success" role="status">Changes saved.</p>}
    <div className="form-actions">{close && <button type="button" className="button" disabled={pending} onClick={close}>Cancel</button>}
      <button className="button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : label}</button></div>
  </form>;
  return inline ? content : <Modal title={title} close={() => { if (!busy.current) close?.(); }}>{content}</Modal>;
}

export function Lookup({ sources, children }: { sources: { isPending: boolean; error: Error | null }[]; children: React.ReactNode }) {
  const error = sources.find(source => source.error)?.error;
  return error ? <Failure error={error}/> : sources.some(source => source.isPending) ? <Loading/> : children;
}
