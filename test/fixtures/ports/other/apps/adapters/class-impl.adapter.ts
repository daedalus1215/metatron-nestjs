import { Injectable } from '@nestjs/common';
import { ClassPort } from '../../../things/domain/ports/things.port';

@Injectable()
export class ClassImplAdapter implements ClassPort {
  async go(): Promise<void> {
    return;
  }
}
