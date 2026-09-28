export const ROUTES = {
  THINGS: '/things',
  THING: (id: number) => `/things/${id}`,
} as const;

export const ROUTE_PATTERNS = {
  THING: ':id',
} as const;
