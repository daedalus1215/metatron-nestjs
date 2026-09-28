import { Injectable } from '@nestjs/common';
import { StringPort } from '../../domain/ports/things.port';

@Injectable()
export class StringImplAdapter implements StringPort {
  async shout(): Promise<void> {
    return;
  }
}
