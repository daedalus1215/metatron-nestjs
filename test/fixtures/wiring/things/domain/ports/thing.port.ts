export const THING_PORT = Symbol('THING_PORT');

export interface ThingPort {
  ping(): string;
}
