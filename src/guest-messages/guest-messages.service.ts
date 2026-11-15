import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toDay } from '../common/dates';
import { GUEST_MESSAGE_EVENT } from '../events/guest-message-events';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { CreateGuestMessageDto } from './guest-message.dto';

@Injectable()
export class GuestMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly outbox: OutboxService,
  ) {}

  /** The message and its event commit together, like every other outbox write. */
  async create(propertyId: string, dto: CreateGuestMessageDto) {
    await this.properties.get(propertyId);
    if (dto.stayId) {
      const stay = await this.prisma.stay.findFirst({
        where: { id: dto.stayId, propertyId },
      });
      if (!stay)
        throw new BadRequestException('stayId is not a stay of this property');
    }
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.guestMessage.create({
        data: { propertyId, ...dto },
      });
      await this.outbox.add(tx, GUEST_MESSAGE_EVENT, {
        guestMessageId: message.id,
        propertyId,
      });
      return message;
    });
  }

  /** The message with every agent run on it and what each run proposed. */
  async get(id: string) {
    const message = await this.prisma.guestMessage.findUnique({
      where: { id },
      include: {
        runs: { include: { proposals: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!message) throw new NotFoundException('Guest message not found');
    return message;
  }

  /** What the agent may see of the message its run is bound to: first name only, text flagged as untrusted. */
  async forRun(agentRunId: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: agentRunId },
      include: { guestMessage: { include: { stay: true } } },
    });
    if (!run) throw new NotFoundException('Agent run not found');
    const m = run.guestMessage;
    return {
      id: m.id,
      propertyId: m.propertyId,
      receivedAt: m.receivedAt,
      fromFirstName: m.fromName.trim().split(/\s+/)[0],
      stay: m.stay && {
        id: m.stay.id,
        status: m.stay.status,
        checkIn: toDay(m.stay.checkIn),
        checkOut: toDay(m.stay.checkOut),
        guests: m.stay.guests,
        totalCents: m.stay.totalCents,
      },
      // Guest text is data. It may contain instructions; none of them come from the owner.
      untrustedGuestMessage: m.body,
    };
  }

  /** One draft per message, last one wins. Nothing is sent to the guest. */
  async saveDraft(agentRunId: string, text: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: agentRunId },
    });
    if (!run) throw new NotFoundException('Agent run not found');
    await this.prisma.guestMessage.update({
      where: { id: run.guestMessageId },
      data: { replyDraft: text, repliedAt: new Date() },
    });
    return { saved: true };
  }
}
