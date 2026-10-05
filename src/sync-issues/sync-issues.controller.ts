import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { SyncIssuesService } from './sync-issues.service';

class ListQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  resolved?: boolean;
}

@ApiTags('sync-issues')
@Controller('sync-issues')
export class SyncIssuesController {
  constructor(private readonly issues: SyncIssuesService) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.issues.list(q.resolved);
  }

  @Post(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.issues.resolve(id);
  }
}
