import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthStore } from '../store/authStore';
import { Spinner } from '../components/ui/Spinner';

/** Protected routes: wait for the session check, then render or redirect to /login. */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-slate-500" role="status">
        <Spinner /> Restoring your session…
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}
