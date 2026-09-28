import { Module } from '@nestjs/common';
import { TrackService } from './domain/services/track.service';
import { TrackEntity } from './domain/entities/track.entity';

@Module({ providers: [TrackService, TrackEntity] })
export class TimeTracksModule {}
