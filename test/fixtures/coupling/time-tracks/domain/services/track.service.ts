import { Injectable } from '@nestjs/common';
import { TrackEntity } from '../entities/track.entity';

@Injectable()
export class TrackService {
  constructor(private readonly track: TrackEntity) {}

  start() {
    return this.track.id;
  }
}
