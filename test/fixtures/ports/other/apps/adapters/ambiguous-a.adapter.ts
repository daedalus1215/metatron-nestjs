import { Injectable } from '@nestjs/common';
import { AmbiguousPort } from '../../../things/domain/ports/things.port';

@Injectable()
export class AmbiguousAAdapter implements AmbiguousPort {
  async pick(): Promise<void> {
    return;
  }
}
