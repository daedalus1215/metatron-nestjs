import { Outlet, useNavigate } from 'react-router-dom';
import { useThings } from './hooks/useThings';
import { ThingRow } from './components/ThingRow';
import { Header } from '@/components/Header/Header';

export const ThingsPage = () => {
  const { data } = useThings();
  const navigate = useNavigate();
  return (
    <main>
      <Header title="All things" subtitle="listed" />
      <ul>{(data ?? []).map((t) => <ThingRow key={t.id} thing={t} onPick={(id) => navigate(`/things/${id}`)} />)}</ul>
      <Outlet />
    </main>
  );
};
