interface Death {
  queue: string;
  reason: string;
  count: number;
}

/** How many times RabbitMQ has seen this message rejected from `queue` (its x-death history). */
export function deathCount(
  headers: { 'x-death'?: Death[] } | undefined,
  queue: string,
): number {
  return (
    headers?.['x-death']?.find(
      (d) => d.queue === queue && d.reason === 'rejected',
    )?.count ?? 0
  );
}
