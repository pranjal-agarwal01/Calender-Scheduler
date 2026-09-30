import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuthStore } from './store/authStore';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { CalendarPage } from './pages/CalendarPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { Toasts } from './components/ui/Toasts';
import { LiveRegion } from './components/ui/LiveRegion';

export default function App() {
  useEffect(() => {
    void useAuthStore.getState().init(); // restore the session with GET /auth/me
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<CalendarPage />}>
            <Route path="/calendar" element={null} />
            <Route path="/events/:eventId" element={null} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/calendar" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toasts />
      <LiveRegion />
    </BrowserRouter>
  );
}
