import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

function resolveOutline(evt) {
  // Soporta: { outline: { course, modules } } y { outline: { outline: { course, modules } } }
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course && o1.modules) return o1;           // forma plana
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline; // anidada
  return { course: null, modules: [] };
}

export const handler = async (event) => {
  // Log útil para CloudWatch
  console.log('[PERSIST_MODULES][IN] keys:', Object.keys(event || {}));
  console.log('[PERSIST_MODULES][DBG] outline keys:', Object.keys(event?.outline || {}));

  const { course, modules } = resolveOutline(event);
  if (!course?.id) {
    console.error('[PERSIST_MODULES][ERR] Missing course.id', { gotCourse: course });
    throw new Error('MISSING_COURSE_ID');
  }

  const courseId = course.id;
  const list = Array.isArray(modules) ? modules : [];
  console.log('[PERSIST_MODULES][DBG] courseId:', courseId, 'modules:', list.length);

  if (list.length === 0) return { totalModules: 0 };

  // SK = MODULE#<position>#<moduleId>
  const puts = list.map((m, idx) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `MODULE#${(m.position ?? idx + 1)}#${m.id}`,
        etype: 'MODULE',
        moduleId: m.id,
        position: m.position ?? (idx + 1),
        title: m.title,
        createdAt: new Date().toISOString(),
      }
    }
  }));

  for (let i = 0; i < puts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.modulesTable]: puts.slice(i, i + 25) }
    }));
  }

  console.log('[PERSIST_MODULES][OUT] totalModules:', list.length);
  return { totalModules: list.length };
};
