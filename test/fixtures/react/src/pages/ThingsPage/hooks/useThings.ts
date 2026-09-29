import { useQuery } from '@tanstack/react-query';
import { fetchThings } from '@/api/requests/things.requests';

export const useThings = () => useQuery({ queryKey: ['things'], queryFn: fetchThings });
