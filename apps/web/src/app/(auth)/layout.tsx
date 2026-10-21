import { CalendarClock, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

const POINTS = [
  { icon: Target, text: 'همه وظایف سازمان در یک مرجع واحد، با مسئول، مهلت و اولویت مشخص' },
  { icon: CalendarClock, text: 'یادآوری خودکار پیش و پس از مهلت و شناسایی به‌موقع تأخیرها' },
  { icon: Sparkles, text: 'دستیار هوشمند برای ایجاد وظیفه از متن، خلاصه مدیریتی و تحلیل ریسک' },
  { icon: ShieldCheck, text: 'دسترسی مبتنی بر نقش و تفکیک اطلاعات هر دپارتمان' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-8" />
          {children}
        </div>
      </main>
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="absolute -left-24 -top-24 size-96 rounded-full bg-white/5" aria-hidden />
        <div className="absolute -bottom-32 left-20 size-80 rounded-full bg-white/5" aria-hidden />
        <h2 className="relative text-3xl font-bold leading-snug">
          کار درست، به‌موقع،
          <br />
          با دید روشن مدیریتی
        </h2>
        <p className="relative mt-4 max-w-md leading-8 opacity-85">
          کاربان چرخه کامل مدیریت وظایف را از ایجاد و تخصیص تا پیگیری، تکمیل و گزارش در یک سامانه یکپارچه پوشش می‌دهد.
        </p>
        <ul className="relative mt-10 grid max-w-md gap-5">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 leading-7">
              <span className="mt-0.5 rounded-lg bg-white/10 p-2">
                <Icon className="size-4" />
              </span>
              <span className="opacity-90">{text}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
