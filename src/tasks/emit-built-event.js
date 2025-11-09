import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { env } from '../core/env.js';

const eb = new EventBridgeClient({});

export const handler = async (event) => {
  const { userId } = event;
  const courseId = event.outline.course.id;

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: env.eventBusName,
      Source: 'novalearn.orchestrator',
      DetailType: 'nl.course.built',
      Detail: JSON.stringify({
        userId, courseId,
        modules: event.outline.modules?.length || 0,
        lessons: event.lessons?.items?.length || 0
      })
    }]
  }));

  return { status: 'emitted', courseId };
};
