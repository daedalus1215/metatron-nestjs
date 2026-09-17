import { Inject, Injectable } from '@nestjs/common';
import {
  THING_PORT, ThingPort,
  CLASS_PORT, ClassPort,
  FACTORY_PORT, FactoryPort,
  StringPort,
  AMBIGUOUS_PORT, AmbiguousPort,
  UNBOUND_PORT, UnboundPort,
} from '../ports/things.port';
import { PlainService } from './plain.service';

@Injectable()
export class ThingService {
  constructor(
    @Inject(THING_PORT)
    private readonly thingPort: ThingPort,
    @Inject(CLASS_PORT) private readonly classPort: ClassPort,
    @Inject(FACTORY_PORT) private readonly factoryPort: FactoryPort,
    @Inject('STRING_TOKEN') private readonly stringPort: StringPort,
    @Inject(AMBIGUOUS_PORT) private readonly ambiguousPort: AmbiguousPort,
    @Inject(UNBOUND_PORT) private readonly unboundPort: UnboundPort,
    @Inject(PlainService) private readonly plain: PlainService,
  ) {}

  async run(id: number): Promise<void> {
    await this.thingPort.save(id);
    await this.classPort.go();
    await this.factoryPort.make();
    await this.stringPort.shout();
    await this.ambiguousPort.pick();
    await this.unboundPort.lost();
    await this.plain.hello();
  }
}
