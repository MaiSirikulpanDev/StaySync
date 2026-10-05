import { Module } from '@nestjs/common';
import { SyncIssuesController } from './sync-issues.controller';
import { SyncIssuesService } from './sync-issues.service';

@Module({ controllers: [SyncIssuesController], providers: [SyncIssuesService] })
export class SyncIssuesModule {}
