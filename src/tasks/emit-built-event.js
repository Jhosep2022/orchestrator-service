// src/tasks/emit-built-event.js
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { env } from '../core/env.js';

const eb = new EventBridgeClient({});

// ---- pickers robustos
const pickCourseId = (evt) =>
  evt?.courseId ??
  evt?.payload?.courseId ??
  evt?.payload?.draftCourseId ??
  evt?.outline?.course?.id ??
  evt?.outline?.outline?.course?.id ?? // <- tu caso
  null;

const pickOutlineModulesLen = (evt) =>
  Array.isArray(evt?.outline?.modules) ? evt.outline.modules.length
  : Array.isArray(evt?.outline?.outline?.modules) ? evt.outline.outline.modules.length
  : 0;

const pickLessonsLen = (evt) =>
  Array.isArray(evt?.lessons?.items) ? evt.lessons.items.length
  : Array.isArray(evt?.lessons?.lessons?.items) ? evt.lessons.lessons.items.length
  : 0;

export const handler = async (event = {}) => {
  const requestId = event.requestId || 'no-request-id';
  const userId = event.userId || event.payload?.userId || 'unknown';
  const courseId = pickCourseId(event);
  const modules = pickOutlineModulesLen(event);
  const lessons = pickLessonsLen(event);

  if (!env.eventBusName) {
    console.error('[EMIT][ERR] Missing eventBusName', { requestId, envEventBus: env?.eventBusName });
    throw new Error('MISSING_EVENT_BUS');
  }
  if (!userId || userId === 'unknown') {
    console.error('[EMIT][ERR] Missing userId', { requestId });
    throw new Error('MISSING_USER_ID');
  }
  if (!courseId) {
    console.error('[EMIT][ERR] Missing courseId', {
      requestId,
      fromPayload: event?.payload?.draftCourseId,
      fromOutline: event?.outline?.outline?.course?.id
    });
    throw new Error('MISSING_COURSE_ID');
  }

  console.log('[EMIT][IN]', JSON.stringify({ requestId, userId, courseId, modules, lessons, bus: env.eventBusName }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: env.eventBusName,
      Source: 'novalearn.orchestrator',
      DetailType: 'nl.course.built',
      Detail: JSON.stringify({ requestId, userId, courseId, modules, lessons })
    }]
  }));

  console.log('[EMIT][OUT]', JSON.stringify({ requestId, status: 'emitted', courseId }));
  return { status: 'emitted', courseId, modules, lessons };
};
