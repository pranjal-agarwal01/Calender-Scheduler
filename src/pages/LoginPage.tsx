import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { EXPIRY_OPTIONS } from '../config';

const DEMO = { username: 'emilys', password: 'emilyspass' };

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const notice = useAuthStore((s) => s.notice);
  const login = useAuthStore((s) => s.login);
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from ?? '/calendar';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [expiresInMins, setExpiresInMins] = useState(30);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return; // double-click safe: one POST /auth/login
    const errors: typeof fieldErrors = {};
    if (!username.trim()) errors.username = 'Enter your username.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setError(null);
    if (errors.username || errors.password) {
      (errors.username ? usernameRef : passwordRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      await login(username, password, expiresInMins);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
      passwordRef.current?.select();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const inputClass = (invalid?: string) =>
    `h-11 w-full rounded-lg border bg-white px-3 text-sm outline-none transition-colors focus:ring-2 ${
      invalid ? 'border-rose-400 focus:ring-rose-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
    }`;

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 via-white to-sky-50 px-4 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg">
            <Icon name="calendar" size={26} />
          </span>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in to Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">Use any DummyJSON user.</p>
        </div>

        <form noValidate onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {(error || notice) && (
            <div
              role="alert"
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                error ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'
              }`}
            >
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span>{error ?? notice}</span>
            </div>
          )}

          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              ref={usernameRef}
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={!!fieldErrors.username}
              aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              className={inputClass(fieldErrors.username)}
            />
            {fieldErrors.username && (
              <p id="username-error" className="mt-1 text-xs font-medium text-rose-600">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              Password
            </label>
            <div className="relative">
              <input
                ref={passwordRef}
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={`${inputClass(fieldErrors.password)} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
            {fieldErrors.password && (
              <p id="password-error" className="mt-1 text-xs font-medium text-rose-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="expires" className="mb-1 block text-sm font-medium text-slate-700">
              Session token lifetime
            </label>
            <select
              id="expires"
              value={expiresInMins}
              onChange={(e) => setExpiresInMins(Number(e.target.value))}
              className={inputClass()}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" variant="primary" loading={submitting} className="h-11 w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setUsername(DEMO.username);
              setPassword(DEMO.password);
              setFieldErrors({});
              setError(null);
            }}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800"
          >
            Fill demo account <span className="font-mono text-xs">({DEMO.username})</span>
          </button>
        </form>
      </main>
    </div>
  );
}
