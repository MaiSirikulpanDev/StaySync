import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateGuestMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(200) fromName: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) body: string;
  @IsOptional() @IsUUID() stayId?: string;
}
