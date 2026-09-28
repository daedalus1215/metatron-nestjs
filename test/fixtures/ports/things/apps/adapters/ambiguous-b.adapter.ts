import { Injectable } from '@nestjs/common';
import { AmbiguousPort } from '../../domain/ports/things.port';

@Injectable()
export class AmbiguousBAdapter implements AmbiguousPort {
  async pick(): Promise<void> {
    return;
  }
}
