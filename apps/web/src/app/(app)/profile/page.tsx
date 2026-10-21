'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Send } from 'lucide-react';
import type { NotificationPreferences } from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Switch,
} from '@/components/ui/primitives';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { del, errorMessage, get, patch, post } from '@/lib/api';
import { qk, useSession } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

function PasswordCard({ forced }: { forced: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({ current: '', next: '', confirm: '' });
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post('/auth/change-password', { currentPassword: f.current, newPassword: f.next }),
    onSuccess: () => {
      toast.success('رمز عبور تغییر کرد. سایر نشست‌ها خارج شدند.');
      setF({ current: '', next: '', confirm: '' });
      qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card className={forced ? 'border-warning' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> تغییر رمز عبور
        </CardTitle>
        {forced && (
          <CardDescription className="text-warning">برای ادامه، ابتدا رمز عبور موقت خود را تغییر دهید.</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (f.next !== f.confirm) return setError('تکرار رمز عبور یکسان نیست.');
            m.mutate();
          }}
        >
          {error && <ErrorState message={error} />}
          <Field label="رمز عبور فعلی" htmlFor="current">
            <Input
              id="current"
              type="password"
              dir="ltr"
              value={f.current}
              onChange={(e) => setF({ ...f, current: e.target.value })}
              required
              autoComplete="current-password"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="رمز جدید" htmlFor="next" hint="حداقل ۸ کاراکتر، شامل حروف و عدد">
              <Input
                id="next"
                type="password"
                dir="ltr"
                value={f.next}
                onChange={(e) => setF({ ...f, next: e.target.value })}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="تکرار رمز جدید" htmlFor="confirm">
              <Input
                id="confirm"
                type="password"
                dir="ltr"
                value={f.confirm}
                onChange={(e) => setF({ ...f, confirm: e.target.value })}
                required
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div>
            <Button type="submit" loading={m.isPending}>
              ذخیره رمز جدید
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NotificationsCard() {
  const me = useSession();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['preferences'],
    queryFn: () => get<NotificationPreferences>('/notifications/preferences'),
  });
  const [link, setLink] = React.useState<{ deepLink: string | null; command: string; expiresAt: string } | null>(null);
  const update = useMutation({
    mutationFn: (p: Partial<NotificationPreferences>) =>
      patch<NotificationPreferences>('/notifications/preferences', p),
    onSuccess: (d) => qc.setQueryData(['preferences'], d),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createLink = useMutation({
    mutationFn: () =>
      post<{ deepLink: string | null; command: string; expiresAt: string }>('/notifications/telegram/link'),
    onSuccess: setLink,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: () => del('/notifications/telegram/link'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success('اتصال تلگرام قطع شد.');
    },
  });
  const p = prefs.data;
  const row = (label: string, hint: string, key: keyof NotificationPreferences) => (
    <label className="flex items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={!!p?.[key]} onCheckedChange={(v) => update.mutate({ [key]: v })} disabled={!p} />
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>اعلان‌ها</CardTitle>
        <CardDescription>
          اعلان‌های درون‌برنامه همیشه فعال‌اند. موارد فوری و اشاره‌ها بلافاصله و فعالیت‌های کم‌اهمیت به‌صورت خلاصه
          روزانه ارسال می‌شوند.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {row('ایمیل', me.email ?? 'ایمیلی ثبت نشده است', 'emailEnabled')}
        {row('خلاصه روزانه ایمیلی', 'نظرات و تغییرات کم‌اهمیت در یک ایمیل روزانه', 'digestEnabled')}
        {row('تلگرام', 'یادآوری‌ها و هشدارهای مهم', 'telegramEnabled')}
        <div className="grid gap-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              اتصال تلگرام: {me.telegramLinked ? <Badge variant="success">متصل</Badge> : <Badge>متصل نیست</Badge>}
            </span>
            {me.telegramLinked ? (
              <Button variant="outline" size="sm" onClick={() => unlink.mutate()} loading={unlink.isPending}>
                قطع اتصال
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => createLink.mutate()} loading={createLink.isPending}>
                <Send /> دریافت کد اتصال
              </Button>
            )}
          </div>
          {link && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-7">
              {link.deepLink ? (
                <>
                  روی{' '}
                  <a
                    href={link.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline"
                  >
                    این پیوند
                  </a>{' '}
                  بزنید و در ربات «Start» را بفشارید.
                </>
              ) : (
                <>در ربات کاربان این دستور را ارسال کنید:</>
              )}
              <code dir="ltr" className="mt-1 block rounded bg-card px-2 py-1 text-xs">
                {link.command}
              </code>
              <span className="text-xs text-muted-foreground">اعتبار تا {formatDateTime(link.expiresAt)}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            تلگرام فقط برای اطلاع‌رسانی است؛ تمام عملیات روی وظایف در کاربان انجام می‌شود.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileInner() {
  const me = useSession();
  const forced = useSearchParams().get('changePassword') === '1' || me.mustChangePassword;
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader title="پروفایل و تنظیمات" />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <Avatar name={me.employee.fullName} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{me.employee.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {[me.employee.jobTitle, me.employee.departmentName].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              {me.username}
              {me.email ? ` · ${me.email}` : ''}
            </p>
          </div>
          <Badge variant="primary">{me.role.name}</Badge>
        </CardContent>
      </Card>
      <PasswordCard forced={forced} />
      <NotificationsCard />
    </div>
  );
}

export default function ProfilePage() {
  return (
    <React.Suspense fallback={<Spinner />}>
      <ProfileInner />
    </React.Suspense>
  );
}
