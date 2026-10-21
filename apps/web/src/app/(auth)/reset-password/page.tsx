'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/layout';
import { errorMessage, post } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('تکرار رمز عبور با رمز عبور یکسان نیست.');
    setLoading(true);
    setError(null);
    try {
      await post('/auth/reset-password', { token, newPassword: password });
      router.replace('/login?reset=1');
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  if (!token) return <ErrorState message="پیوند بازیابی نامعتبر است." />;
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">تعیین رمز عبور جدید</h1>
        <p className="mt-1 text-sm text-muted-foreground">حداقل ۸ کاراکتر، شامل حروف و عدد.</p>
      </div>
      {error && <ErrorState message={error} />}
      <Field label="رمز عبور جدید" htmlFor="password">
        <Input
          id="password"
          type="password"
          dir="ltr"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field label="تکرار رمز عبور" htmlFor="confirm">
        <Input
          id="confirm"
          type="password"
          dir="ltr"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Button type="submit" size="lg" loading={loading}>
        ذخیره رمز عبور
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        بازگشت به صفحه ورود
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense>
      <ResetForm />
    </React.Suspense>
  );
}
