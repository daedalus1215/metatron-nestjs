import { useQuery } from '@tanstack/react-query';
import api from '../../../api/axios';

// A helper beside the hook: where the hook's HTTP call lives.
const fetchName = async (id: number): Promise<string> => (await api.get(`/things/${id}/name`)).data;

export const useThingName = (id: number) => useQuery({ queryKey: ['name', id], queryFn: () => fetchName(id) });
