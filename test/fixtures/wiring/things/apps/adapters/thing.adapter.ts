import { Injectable } from '@nestjs/common';
import { ThingPort } from '../../domain/ports/thing.port';

@Injectable()
export class ThingAdapter implements ThingPort {
  ping(): string {
    return 'pong';
  }
}
