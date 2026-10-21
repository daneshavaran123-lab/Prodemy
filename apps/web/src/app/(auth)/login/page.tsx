'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/layout';
import { errorMessage, post } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await post('/auth/login', { username: username.trim(), password });
      qc.clear();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">ورود به کاربان</h1>
        <p className="mt-1 text-sm text-muted-foreground">با نام کاربری و رمز عبور سازمانی وارد شوید.</p>
      </div>
      {params.get('registered') && (
        <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          ثبت‌نام انجام شد. پس از تأیید حساب توسط مدیر سیستم می‌توانید وارد شوید.
        </div>
      )}
      {params.get('reset') && (
        <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          رمز عبور تغییر کرد. با رمز جدید وارد شوید.
        </div>
      )}
      {error && <ErrorState message={error} />}
      <Field label="نام کاربری" htmlFor="username">
        <Input
          id="username"
          dir="ltr"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="رمز عبور" htmlFor="password">
        <Input
          id="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          رمز عبور را فراموش کرده‌اید؟
        </Link>
      </div>
      <Button type="submit" size="lg" loading={loading}>
        <LogIn /> ورود
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        حساب کاربری ندارید؟{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          ثبت‌نام
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}
