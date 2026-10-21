'use client';

import * as React from 'react';
import { Dialog as D, DropdownMenu as DM, Popover as P, Select as S } from 'radix-ui';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------- dialog */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  size = 'md',
  ...props
}: React.ComponentProps<typeof D.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card shadow-lg focus:outline-none',
          { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="grid gap-1">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="text-sm text-muted-foreground">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
            )}
          </div>
          <D.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted cursor-pointer" aria-label="بستن">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

/** Side drawer (mobile navigation, filters). Opens from the start (right) edge in RTL. */
export function SheetContent({
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <D.Content
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e bg-sidebar shadow-xl focus:outline-none',
          className,
        )}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/* ---------------------------------------------------------------- dropdown */

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        destructive && 'text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
}

/* ---------------------------------------------------------------- popover */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, align = 'start', ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md focus:outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

/* ---------------------------------------------------------------- select */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

/** Radix select with a placeholder; `value=''` means "nothing selected". */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'انتخاب کنید',
  className,
  disabled,
  id,
  allowClear,
  clearLabel = 'همه',
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const CLEAR = '__all__';
  return (
    <S.Root
      value={value || (allowClear ? CLEAR : undefined)}
      onValueChange={(v) => onValueChange(v === CLEAR ? '' : v)}
      disabled={disabled}
    >
      <S.Trigger
        id={id}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 data-[placeholder]:text-muted-foreground cursor-pointer',
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="size-4 opacity-60" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-popover shadow-md"
        >
          <S.Viewport className="p-1">
            {allowClear && (
              <SelectItem value={CLEAR}>
                <span className="text-muted-foreground">{clearLabel}</span>
              </SelectItem>
            )}
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <S.Item
      value={value}
      className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pe-8 ps-2 text-sm outline-none data-[highlighted]:bg-muted"
    >
      <S.ItemText>{children}</S.ItemText>
      <S.ItemIndicator className="absolute end-2">
        <Check className="size-4" />
      </S.ItemIndicator>
    </S.Item>
  );
}
