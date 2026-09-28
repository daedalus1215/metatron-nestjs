import { Module } from '@nestjs/common';
import { ClassImplAdapter } from './apps/adapters/class-impl.adapter';
import { AmbiguousAAdapter } from './apps/adapters/ambiguous-a.adapter';
import { CLASS_PORT, AMBIGUOUS_PORT } from '../things/domain/ports/things.port';

// CLASS_PORT is injected in things/ and provided here: the binding table has
// to be global, not per-module.
@Module({
  providers: [
    { provide: CLASS_PORT, useClass: ClassImplAdapter },
    AmbiguousAAdapter,
    { provide: AMBIGUOUS_PORT, useExisting: AmbiguousAAdapter },
  ],
  exports: [CLASS_PORT, AMBIGUOUS_PORT],
})
export class OtherModule {}
