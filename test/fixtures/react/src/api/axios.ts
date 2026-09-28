import axios from 'axios';

const api = axios.create({ baseURL: '/' });
api.interceptors.request.use((config) => {
  if (!config.url?.startsWith('/api')) config.url = `/api${config.url}`;
  return config;
});

export default api;
