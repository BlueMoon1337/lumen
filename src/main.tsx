import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// One bundle, three windows: the operator view plus the audience and stage outputs.
const route = location.hash.replace(/^#\/?/, '');
const App =
  route === 'output'
    ? lazy(() => import('./components/OutputApp'))
    : route === 'stage'
      ? lazy(() => import('./components/StageApp'))
      : lazy(() => import('./components/ControlApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);
