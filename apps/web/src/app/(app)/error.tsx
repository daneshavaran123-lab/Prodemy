'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-xl font-bold">خطایی در نمایش این صفحه رخ داد</h1>
      <p className="text-sm text-muted-foreground">
        لطفاً دوباره تلاش کنید. اگر مشکل ادامه داشت، با پشتیبانی فناوری اطلاعات تماس بگیرید.
      </p>
      {error.digest && <code className="text-xs text-muted-foreground">{error.digest}</code>}
      <Button onClick={reset}>تلاش مجدد</Button>
    </div>
  );
}
