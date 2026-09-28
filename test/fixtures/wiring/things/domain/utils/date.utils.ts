export function formatDate(d: Date): string {
  return pad(d.getDate());
}

export const parseDate = (s: string): Date => new Date(s);

export function isoWeek(d: Date): number {
  return d.getDay();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function Audited(): MethodDecorator {
  return () => undefined;
}
