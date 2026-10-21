'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { Select } from '@/components/ui/overlays';
import { ErrorState } from '@/components/ui/layout';
import { errorMessage, get, post } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const options = useQuery({
    queryKey: ['registration-options'],
    queryFn: () =>
      get<{ departments: { id: string; name: string }[]; requiresApproval: boolean }>('/auth/registration-options'),
  });
  const [form, setForm] = React.useState({
    fullName: '',
    username: '',
    email: '',
    departmentId: '',
    jobTitle: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError('تکرار رمز عبور با رمز عبور یکسان نیست.');
    if (!form.departmentId) return setError('دپارتمان خود را انتخاب کنید.');
    setLoading(true);
    try {
      const res = await post<{ requiresApproval: boolean }>('/auth/register', {
        fullName: form.fullName,
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        departmentId: form.departmentId,
        jobTitle: form.jobTitle || undefined,
        password: form.password,
      });
      router.replace(res.requiresApproval ? '/login?registered=1' : '/login');
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">ثبت‌نام</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {options.data?.requiresApproval !== false
            ? 'حساب شما پس از تأیید مدیر سیستم فعال می‌شود.'
            : 'پس از ثبت‌نام می‌توانید بلافاصله وارد شوید.'}
        </p>
      </div>
      {error && <ErrorState message={error} />}
      <Field label="نام و نام خانوادگی" htmlFor="fullName" required>
        <Input id="fullName" required value={form.fullName} onChange={set('fullName')} autoComplete="name" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام کاربری" htmlFor="username" required hint="حروف لاتین، مثل ali.rezaei">
          <Input
            id="username"
            dir="ltr"
            required
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
          />
        </Field>
        <Field label="ایمیل" htmlFor="email">
          <Input id="email" type="email" dir="ltr" value={form.email} onChange={set('email')} autoComplete="email" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="دپارتمان" required>
          <Select
            value={form.departmentId}
            onValueChange={(v) => setForm({ ...form, departmentId: v })}
            options={(options.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
            placeholder="انتخاب دپارتمان"
          />
        </Field>
        <Field label="سمت" htmlFor="jobTitle">
          <Input id="jobTitle" value={form.jobTitle} onChange={set('jobTitle')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="رمز عبور" htmlFor="password" required hint="حداقل ۸ کاراکتر، شامل حروف و عدد">
          <Input
            id="password"
            type="password"
            dir="ltr"
            required
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />
        </Field>
        <Field label="تکرار رمز عبور" htmlFor="confirm" required>
          <Input
            id="confirm"
            type="password"
            dir="ltr"
            required
            value={form.confirm}
            onChange={set('confirm')}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <Button type="submit" size="lg" loading={loading}>
        <UserPlus /> ثبت‌نام
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        قبلاً ثبت‌نام کرده‌اید؟{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          ورود
        </Link>
      </p>
    </form>
  );
}
