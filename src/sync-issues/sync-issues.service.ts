import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncIssuesService {
  constructor(private readonly prisma: PrismaService) {}

  list(resolved?: boolean) {
    return this.prisma.syncIssue.findMany({
      where:
        resolved === undefined
          ? {}
          : { resolvedAt: resolved ? { not: null } : null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Idempotent: resolving twice keeps the first resolution time. */
  async resolve(id: string) {
    const issue = await this.prisma.syncIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Sync issue not found');
    if (issue.resolvedAt) return issue;
    return this.prisma.syncIssue.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }
}
