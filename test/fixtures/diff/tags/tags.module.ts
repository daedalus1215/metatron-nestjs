import { Module } from '@nestjs/common';
import { CreateTagAction } from './apps/actions/create-tag/create-tag.action';
import { TagService } from './domain/services/tag.service';

@Module({ controllers: [CreateTagAction], providers: [TagService] })
export class TagsModule {}
