import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchThing, type Thing } from '../../api/requests/things.requests';
import { useMissingHook } from './hooks/useMissingHook';

export function ThingPage() {
  const { id } = useParams();
  const [thing, setThing] = useState<Thing | null>(null);
  useEffect(() => { fetchThing(Number(id)).then(setThing); }, [id]);
  useMissingHook();
  return <article>{thing?.name}</article>;
}
