import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isApiError } from '@/api/errors';
import { AppCrash } from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/context/ThemeContext';
import { AstryxProvider } from '@/theme/AstryxProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { installChunkReload, sessionStorageOrNull } from '@/lib/chunkReload';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Retry only what the API says is temporary; never permission, validation or session errors.
      retry: (count, err) => isApiError(err) && err.retryable && count < 2,
    },
  },
});

function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AstryxProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </AstryxProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// A data router so pages can block navigation while edits are unsaved (useBlocker).
// App keeps its own <Routes> under this single catch-all route.
const router = createBrowserRouter([{ path: '*', element: <Root />, errorElement: <AppCrash /> }]);

installChunkReload(window, sessionStorageOrNull(), () => window.location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
