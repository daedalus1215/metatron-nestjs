export interface ThingPort {
  save(id: number): Promise<void>;
}
export const THING_PORT = Symbol('THING_PORT');

export interface ClassPort {
  go(): Promise<void>;
}
export const CLASS_PORT = Symbol('CLASS_PORT');

export interface FactoryPort {
  make(): Promise<void>;
}
export const FACTORY_PORT = Symbol('FACTORY_PORT');

export interface StringPort {
  shout(): Promise<void>;
}

export interface AmbiguousPort {
  pick(): Promise<void>;
}
export const AMBIGUOUS_PORT = Symbol('AMBIGUOUS_PORT');

export interface UnboundPort {
  lost(): Promise<void>;
}
export const UNBOUND_PORT = Symbol('UNBOUND_PORT');
