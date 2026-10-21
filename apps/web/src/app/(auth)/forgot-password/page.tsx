'use client';

import * as React from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/layout';
import { errorMessage, post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await post('/auth/forgot-password', { identifier: identifier.trim() });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">بازیابی رمز عبور</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          نام کاربری یا ایمیل خود را وارد کنید تا پیوند تعیین رمز جدید برایتان ارسال شود.
        </p>
      </div>
      {sent ? (
        <div className="flex gap-3 rounded-lg border border-success/30 bg-success-soft p-4 text-sm leading-7 text-success">
          <MailCheck className="mt-1 size-5 shrink-0" />
          اگر حسابی با این مشخصات و ایمیل ثبت‌شده وجود داشته باشد، پیوند بازیابی ارسال شد. در صورت نداشتن ایمیل، با مدیر
          سیستم تماس بگیرید.
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          {error && <ErrorState message={error} />}
          <Field label="نام کاربری یا ایمیل" htmlFor="identifier">
            <Input
              id="identifier"
              dir="ltr"
              required
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" loading={loading}>
            ارسال پیوند بازیابی
          </Button>
        </form>
      )}
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        بازگشت به صفحه ورود
      </Link>
    </div>
  );
}
