import { Module } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { StaysModule } from '../../stays/stays.module';
import { OtaClient } from './ota.client';
import { OtaConsumer } from './ota.consumer';

@Module({ imports: [StaysModule], providers: [Clock, OtaClient, OtaConsumer] })
export class MockOtaModule {}
