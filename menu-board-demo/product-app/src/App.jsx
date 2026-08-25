import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Spin } from 'antd';
import ProductPage from './pages/ProductPage.jsx';
import { loadRegistries } from './data/registries.js';

function RedirectToAssets() {
  const { id } = useParams();
  return <Navigate to={`/products/${id}/assets`} replace />;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRegistries()
      .then(() => setReady(true))
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24, color: '#ff4d4f' }}>
        Failed to load brands/types/categories from Firestore: {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/products/new" element={<ProductPage isNew />} />
      <Route path="/products/:id" element={<RedirectToAssets />} />
      <Route path="/products/:id/:tab" element={<ProductPage />} />
      <Route path="*" element={<Navigate to="/products/new" replace />} />
    </Routes>
  );
}
