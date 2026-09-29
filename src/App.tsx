import { useEffect } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { CatalogPage } from './pages/CatalogPage';
import { LoginPage } from './pages/LoginPage';
import { MapPage } from './pages/MapPage';
import { ProfilePage } from './pages/ProfilePage';
import { RoutePage } from './pages/RoutePage';
import { UploadPage } from './pages/UploadPage';
import { StoreProvider, useStore } from './store';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  const { t } = useStore();
  return (
    <div className="page">
      <h1 className="h1">{t('notFound.title')}</h1>
      <Link to="/">{t('route.back')}</Link>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      {/* Hash routing keeps deep links working on GitHub Pages without server rewrites. */}
      <HashRouter>
        <ScrollToTop />
        <div className="app">
          <Header />
          <Routes>
            <Route path="/" element={<MapPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/route/:id" element={<RoutePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:tab" element={<ProfilePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </HashRouter>
    </StoreProvider>
  );
}
