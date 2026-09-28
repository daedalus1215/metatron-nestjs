import { Module } from '@nestjs/common';
import { GetThingAction } from './apps/actions/get-thing.action';
import { ThingService, ThingAuditor } from './domain/services/thing.service';
import { ThingArrowService } from './domain/services/thing-arrow.service';
import { ThingRepository } from './infra/repositories/thing.repository';
import { ThingAdapter } from './apps/adapters/thing.adapter';
import { THING_PORT } from './domain/ports/thing.port';

@Module({
  providers: [
    ThingService,
    ThingAuditor,
    ThingArrowService,
    ThingRepository,
    ThingAdapter,
    { provide: THING_PORT, useExisting: ThingAdapter },
  ],
  controllers: [GetThingAction],
})
export class ThingsModule {}
