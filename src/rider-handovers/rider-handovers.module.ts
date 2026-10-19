import { Module } from '@nestjs/common';
import { RiderHandoversController } from './rider-handovers.controller.js';
import { RiderHandoversService } from './rider-handovers.service.js';

@Module({
  controllers: [RiderHandoversController],
  providers: [RiderHandoversService],
})
export class RiderHandoversModule {}
