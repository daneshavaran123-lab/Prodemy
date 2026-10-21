import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-2xl font-bold">صفحه پیدا نشد</h1>
      <p className="text-sm text-muted-foreground">نشانی واردشده وجود ندارد یا جابه‌جا شده است.</p>
      <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
        بازگشت به داشبورد
      </Link>
    </div>
  );
}
