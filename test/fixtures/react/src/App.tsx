import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { ThingsPage } from './pages/ThingsPage/ThingsPage';
import { ThingPage } from './pages/ThingPage/ThingPage';
import { SidebarProvider } from './contexts/SidebarContext';
import { ROUTES, ROUTE_PATTERNS } from './constants/routes';

function App() {
  return (
    <SidebarProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path={ROUTES.THINGS} element={<ThingsPage />}>
            <Route path={ROUTE_PATTERNS.THING} element={<ThingPage />} />
          </Route>
          <Route path="/about" element={<ThingsPage />} />
          <Route path={ROUTES.THING(1)} element={<ThingPage />} />
        </Route>
      </Routes>
    </SidebarProvider>
  );
}

export default App;
