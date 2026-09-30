import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-bold text-brand-600">404</p>
      <h1 className="text-xl font-semibold text-slate-800">Page not found</h1>
      <p className="text-sm text-slate-500">The page you’re looking for doesn’t exist.</p>
      <Link to="/calendar" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        Go to calendar
      </Link>
    </main>
  );
}
