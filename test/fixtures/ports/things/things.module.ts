import { Module } from '@nestjs/common';
import { DoThingAction } from './apps/actions/do-thing.action';
import { ThingService } from './domain/services/thing.service';
import { PlainService } from './domain/services/plain.service';
import { ThingRepository } from './infra/repositories/thing.repository';
import { ThingAdapter } from './apps/adapters/thing.adapter';
import { StringImplAdapter } from './apps/adapters/string-impl.adapter';
import { AmbiguousBAdapter } from './apps/adapters/ambiguous-b.adapter';
import {
  THING_PORT,
  FACTORY_PORT,
  AMBIGUOUS_PORT,
} from './domain/ports/things.port';

// The useFactory arrow comes before the other providers on purpose: `=>`
// contains a `>`, which a bracket-depth splitter miscounts, and every provider
// after it must still be read.
@Module({
  providers: [
    ThingService,
    PlainService,
    ThingRepository,
    ThingAdapter,
    { provide: FACTORY_PORT, useFactory: () => ({ make: async () => undefined }) },
    { provide: THING_PORT, useExisting: ThingAdapter },
    { provide: 'STRING_TOKEN', useClass: StringImplAdapter },
    {
      provide: AMBIGUOUS_PORT,
      useExisting: AmbiguousBAdapter,
    },
  ],
  controllers: [DoThingAction],
})
export class ThingsModule {}
