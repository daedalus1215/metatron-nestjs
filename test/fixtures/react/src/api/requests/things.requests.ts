import api from '../axios';

export type Thing = { id: number; name: string };

export const fetchThings = async (): Promise<Thing[]> => {
  const res = await api.get('/things?sort=name');
  return res.data;
};

export const fetchThing = async (id: number): Promise<Thing> => {
  const res = await api.get<Thing>(
    `/things/${id}`,
  );
  return res.data;
};

export const deleteThing = async (id: number) => {
  await api.delete(`/api/things/${id}`);
};

export const renameThing = async (id: number, name: string) => {
  const url = `/things/${id}/name`;
  await api.patch(url, { name });
};

export const pingMissing = async () => {
  await api.get('/nowhere');
};
