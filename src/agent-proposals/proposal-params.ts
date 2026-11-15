import { BadRequestException } from '@nestjs/common';
import { ProposalType, StayKind } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsUUID, validate } from 'class-validator';
import { ChangeDatesDto, CreateStayDto } from '../stays/stay.dto';

class CancelStayParams {
  @IsUUID() stayId: string;
}

class ChangeDatesParams extends ChangeDatesDto {
  @IsUUID() stayId: string;
}

export type Parsed =
  | { type: 'CREATE_BOOKING' | 'CREATE_BLOCK'; dto: CreateStayDto }
  | { type: 'CANCEL_STAY'; stayId: string }
  | { type: 'CHANGE_DATES'; stayId: string; dto: ChangeDatesDto };

/**
 * Checks proposal params with the same class-validator DTOs the REST API uses, so a proposal
 * that would fail validation on approval is refused when it is filed. The kind is fixed by the
 * type; the property is never a param (it is the message's property).
 */
export async function parseParams(
  type: ProposalType,
  params: Record<string, unknown>,
): Promise<Parsed> {
  const check = async <T extends object>(cls: new () => T, plain: object) => {
    const o = plainToInstance(cls, plain);
    const errors = await validate(o, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException({
        message: 'Invalid params',
        details: errors.flatMap((e) => Object.values(e.constraints ?? {})),
      });
    }
    return o;
  };
  switch (type) {
    case 'CREATE_BOOKING':
    case 'CREATE_BLOCK': {
      const kind =
        type === 'CREATE_BOOKING' ? StayKind.BOOKING : StayKind.BLOCK;
      return { type, dto: await check(CreateStayDto, { ...params, kind }) };
    }
    case 'CANCEL_STAY': {
      const { stayId } = await check(CancelStayParams, params);
      return { type, stayId };
    }
    case 'CHANGE_DATES': {
      const { stayId, ...dto } = await check(ChangeDatesParams, params);
      return { type, stayId, dto };
    }
  }
}
