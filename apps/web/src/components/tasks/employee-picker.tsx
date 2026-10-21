'use client';

import * as React from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { normalizePersian, type DirectoryEmployee } from '@karban/shared';
import { Avatar } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { useDirectory } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface BaseProps {
  /** Restrict the list (e.g. to people the user may assign). */
  filter?: (e: DirectoryEmployee) => boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Pin these first (e.g. current user, team). */
  preferIds?: string[];
}

function useOptions(filter?: (e: DirectoryEmployee) => boolean, preferIds: string[] = []) {
  const { data = [] } = useDirectory();
  return React.useMemo(() => {
    const list = filter ? data.filter(filter) : data;
    const preferred = new Set(preferIds);
    return [...list].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
  }, [data, filter, preferIds]);
}

function PickerList({
  options,
  selected,
  onToggle,
}: {
  options: DirectoryEmployee[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const needle = normalizePersian(q).toLowerCase();
  const filtered = needle
    ? options.filter((e) =>
        normalizePersian(`${e.fullName} ${e.jobTitle ?? ''} ${e.departmentName}`)
          .toLowerCase()
          .includes(needle),
      )
    : options;
  return (
    <div className="w-[min(22rem,calc(100vw-2rem))]">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجوی نام، سمت یا دپارتمان…"
          className="h-9 w-full rounded-md border border-input bg-card ps-8 pe-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto scrollbar-thin" role="listbox">
        {filtered.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">کسی یافت نشد.</li>
        )}
        {filtered.slice(0, 100).map((e) => {
          const isSelected = selected.includes(e.id);
          return (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onToggle(e.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-muted cursor-pointer',
                  isSelected && 'bg-accent',
                )}
              >
                <Avatar name={e.fullName} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[e.jobTitle, e.departmentName].filter(Boolean).join(' · ')}
                    {e.employmentStatus === 'ON_LEAVE' && ' · در مرخصی'}
                  </span>
                </span>
                {isSelected && <Check className="size-4 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const triggerClass =
  'flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer aria-invalid:border-danger disabled:opacity-50';

export function EmployeePicker({
  value,
  onChange,
  filter,
  placeholder = 'انتخاب فرد',
  id,
  invalid,
  disabled,
  preferIds,
  clearable,
}: BaseProps & { value: string | null; onChange: (id: string | null) => void; clearable?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const options = useOptions(filter, preferIds);
  const { data = [] } = useDirectory();
  const current = data.find((e) => e.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" aria-invalid={invalid || undefined} disabled={disabled} className={triggerClass}>
          {current ? (
            <>
              <Avatar name={current.fullName} className="size-6 text-[10px]" />
              <span className="flex-1 truncate text-start">{current.fullName}</span>
            </>
          ) : (
            <span className="flex-1 text-start text-muted-foreground">{placeholder}</span>
          )}
          {clearable && current ? (
            <span
              role="button"
              aria-label="پاک کردن"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="rounded p-0.5 hover:bg-muted"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronDown className="size-4 opacity-60" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-2">
        <PickerList
          options={options}
          selected={value ? [value] : []}
          onToggle={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function MultiEmployeePicker({
  value,
  onChange,
  filter,
  placeholder = 'افزودن همکار',
  id,
  disabled,
  preferIds,
}: BaseProps & { value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const options = useOptions(filter, preferIds);
  const { data = [] } = useDirectory();
  const selected = value.map((v) => data.find((e) => e.id === v)).filter(Boolean) as DirectoryEmployee[];
  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button id={id} type="button" disabled={disabled} className={triggerClass}>
            <span className="flex-1 text-start text-muted-foreground">{placeholder}</span>
            <ChevronDown className="size-4 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-2">
          <PickerList
            options={options}
            selected={value}
            onToggle={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
          />
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pe-1 ps-1 text-xs"
            >
              <Avatar name={e.fullName} className="size-5 text-[9px]" />
              {e.fullName}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== e.id))}
                className="rounded-full p-0.5 hover:bg-muted cursor-pointer"
                aria-label={`حذف ${e.fullName}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
