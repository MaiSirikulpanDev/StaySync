import { KafkaJS } from '@confluentinc/kafka-javascript';
import { randomUUID } from 'node:crypto';
import { DLQ_TOPIC, EVENTS_TOPIC } from '../../src/messaging/messaging.service';

const kafka = () =>
  new KafkaJS.Kafka({
    kafkaJS: { brokers: process.env.KAFKA_BROKERS!.split(',') },
  });

/** Reads the whole events topic under a throwaway group; call stop() when done. */
export async function spyOnEvents(topic = EVENTS_TOPIC) {
  const messages: {
    key: string | null;
    body: { id: string; type: string; payload: any };
  }[] = [];
  const consumer = kafka().consumer({
    kafkaJS: { groupId: `spy-${randomUUID()}`, fromBeginning: true },
  });
  await consumer.connect();
  await consumer.subscribe({ topics: [topic] });
  await consumer.run({
    eachMessage: ({ message }) => {
      messages.push({
        key: message.key?.toString() ?? null,
        body: JSON.parse(message.value!.toString()),
      });
      return Promise.resolve();
    },
  });
  return { messages, stop: () => consumer.disconnect() };
}

/** Total messages ever written to the DLQ topic (it is never purged, so tests compare deltas). */
export async function dlqCount() {
  const admin = kafka().admin();
  await admin.connect();
  try {
    const offsets = await admin.fetchTopicOffsets(DLQ_TOPIC);
    return offsets.reduce((n, o) => n + Number(o.high) - Number(o.low), 0);
  } finally {
    await admin.disconnect();
  }
}
