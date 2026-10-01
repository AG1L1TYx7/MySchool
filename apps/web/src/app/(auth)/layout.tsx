import { MotionPage } from '@/components/motion';
import { Logo } from '@/components/ui';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Logo className="mb-8 text-lg" />
      <MotionPage className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">{children}</MotionPage>
      <p className="mt-8 text-xs text-slate-400">SmartSchool runs on your school&apos;s own infrastructure. Student data never leaves it.</p>
    </main>
  );
}
