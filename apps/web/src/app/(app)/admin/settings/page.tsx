'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { WEEKDAY_LABELS, WEEK_ORDER, toPersianDigits, zonedDateKey, type SystemSettings } from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Switch,
} from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/overlays';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, patch } from '@/lib/api';
import { qk, useSettings } from '@/lib/queries';
import { cn, formatDate, TZ } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${toPersianDigits(String(h).padStart(2, '0'))}:۰۰`,
}));
const offsetLabel = (o: number) =>
  o === 0 ? 'روز مهلت' : o < 0 ? `${toPersianDigits(-o)} روز قبل` : `${toPersianDigits(o)} روز بعد`;

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [s, setS] = React.useState<SystemSettings | null>(null);
  const [newOffset, setNewOffset] = React.useState('');
  const [holiday, setHoliday] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => patch<SystemSettings>('/settings', s),
    onSuccess: (d) => {
      qc.setQueryData(qk.settings, d);
      toast.success('تنظیمات ذخیره شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (settings.isLoading || !s) return <Spinner />;
  const set = <K extends keyof SystemSettings>(k: K, v: SystemSettings[K]) => setS({ ...s, [k]: v });
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <PageHeader
        title="تنظیمات سیستم"
        description="مقادیر پیش‌فرض موارد «نیازمند تأیید» سند نیازمندی‌ها؛ همه تغییرات در لاگ ممیزی ثبت می‌شوند."
        actions={
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            ذخیره تنظیمات
          </Button>
        }
      />
      {save.error && <ErrorState message={errorMessage(save.error)} />}
      <Card>
        <CardHeader>
          <CardTitle>یادآوری مهلت‌ها</CardTitle>
          <CardDescription>
            یادآوری‌ها در این روزها نسبت به روز مهلت ارسال می‌شوند. پس از مهلت، مدیر وظیفه نیز مطلع می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {s.reminderOffsetsDays.map((o) => (
              <span key={o} className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-sm">
                {offsetLabel(o)}
                <button
                  onClick={() =>
                    set(
                      'reminderOffsetsDays',
                      s.reminderOffsetsDays.filter((x) => x !== o),
                    )
                  }
                  className="cursor-pointer rounded-full p-0.5 hover:bg-muted"
                  aria-label="حذف"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(newOffset);
              if (Number.isInteger(n) && !s.reminderOffsetsDays.includes(n))
                set(
                  'reminderOffsetsDays',
                  [...s.reminderOffsetsDays, n].sort((a, b) => a - b),
                );
              setNewOffset('');
            }}
          >
            <Field label="افزودن (منفی = قبل از مهلت)" className="w-56">
              <Input
                type="number"
                dir="ltr"
                min={-30}
                max={30}
                value={newOffset}
                onChange={(e) => setNewOffset(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              <Plus /> افزودن
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>تقویم کاری</CardTitle>
          <CardDescription>
            روزهای کاری و تعطیلات رسمی در محاسبه ریسک تأخیر و وظایف روزانه تکراری استفاده می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {WEEK_ORDER.map((d) => (
              <button
                key={d}
                onClick={() =>
                  set(
                    'workingDays',
                    s.workingDays.includes(d) ? s.workingDays.filter((x) => x !== d) : [...s.workingDays, d],
                  )
                }
                className={cn(
                  'h-9 rounded-md border px-3 text-sm cursor-pointer',
                  s.workingDays.includes(d)
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'bg-card text-muted-foreground',
                )}
              >
                {WEEKDAY_LABELS[d]}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">تعطیلات رسمی</p>
            <div className="flex flex-wrap gap-2">
              {s.holidays.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-sm">
                  {formatDate(`${h}T12:00:00Z`)}
                  <button
                    onClick={() =>
                      set(
                        'holidays',
                        s.holidays.filter((x) => x !== h),
                      )
                    }
                    className="cursor-pointer rounded-full p-0.5 hover:bg-muted"
                    aria-label="حذف"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {!s.holidays.length && <span className="text-sm text-muted-foreground">تعطیلی ثبت نشده است.</span>}
            </div>
            <div className="flex max-w-sm gap-2">
              <DatePicker value={holiday} onChange={setHoliday} placeholder="انتخاب روز تعطیل" />
              <Button
                variant="outline"
                disabled={!holiday}
                onClick={() => {
                  if (!holiday) return;
                  const key = zonedDateKey(new Date(holiday), TZ);
                  if (!s.holidays.includes(key)) set('holidays', [...s.holidays, key].sort());
                  setHoliday(null);
                }}
              >
                <Plus /> افزودن
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>عمومی</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 sm:col-span-2">
            <span>
              <span className="block text-sm font-medium">تأیید حساب‌های ثبت‌نامی توسط مدیر سیستم</span>
              <span className="block text-xs text-muted-foreground">
                در صورت غیرفعال بودن، کاربر بلافاصله پس از ثبت‌نام می‌تواند وارد شود.
              </span>
            </span>
            <Switch
              checked={s.registrationRequiresApproval}
              onCheckedChange={(v) => set('registrationRequiresApproval', v)}
            />
          </label>
          <Field label="حداکثر حجم هر پیوست (مگابایت)">
            <Input
              type="number"
              dir="ltr"
              min={1}
              max={200}
              value={s.attachmentMaxMb}
              onChange={(e) => set('attachmentMaxMb', Number(e.target.value))}
            />
          </Field>
          <Field
            label="روزهای بدون به‌روزرسانی برای هشدار"
            hint="وظایف باز بدون ثبت پیشرفت در این مدت «نیازمند توجه» می‌شوند."
          >
            <Input
              type="number"
              dir="ltr"
              min={1}
              max={30}
              value={s.staleTaskDays}
              onChange={(e) => set('staleTaskDays', Number(e.target.value))}
            />
          </Field>
          <Field label="ساعت ارسال خلاصه روزانه ایمیل">
            <Select value={String(s.digestHour)} onValueChange={(v) => set('digestHour', Number(v))} options={HOURS} />
          </Field>
          <Field label="روز و ساعت خلاصه هفتگی مدیران">
            <div className="flex gap-2">
              <Select
                value={String(s.weeklySummaryDay)}
                onValueChange={(v) => set('weeklySummaryDay', Number(v))}
                options={WEEK_ORDER.map((d) => ({ value: String(d), label: WEEKDAY_LABELS[d] }))}
              />
              <Select
                value={String(s.weeklySummaryHour)}
                onValueChange={(v) => set('weeklySummaryHour', Number(v))}
                options={HOURS}
              />
            </div>
          </Field>
          <Field label="آستانه بار کاری بالا (× میانگین)">
            <Input
              type="number"
              dir="ltr"
              step={0.1}
              min={1.1}
              max={5}
              value={s.overloadThreshold}
              onChange={(e) => set('overloadThreshold', Number(e.target.value))}
            />
          </Field>
          <Field label="آستانه ظرفیت آزاد (× میانگین)">
            <Input
              type="number"
              dir="ltr"
              step={0.1}
              min={0}
              max={0.9}
              value={s.underutilizedThreshold}
              onChange={(e) => set('underutilizedThreshold', Number(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}
