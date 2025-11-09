import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { items } = event.resources || {};
  const courseId = event?.outline?.course?.id;
  if (!Array.isArray(items) || items.length === 0) return { created: 0, linked: 0 };
  if (!courseId) throw new Error('COURSE_ID_REQUIRED_FOR_RESOURCES');

  // 1) Recursos globales
  const globalPuts = items.map((r) => ({
    PutRequest: {
      Item: {
        PK: 'RES#GLOBAL',
        SK: `RES#${r.slug}`,
        etype: 'RESOURCE',
        slug: r.slug,
        title: r.title,
        resource_type: r.resource_type,
        duration_minutes: r.duration_minutes,
        description: r.description,
        is_published: true,
        createdAt: new Date().toISOString(),

        // GSI para listar por tipo si lo necesitas
        GSI1PK: 'TYPE#RESOURCE',
        GSI1SK: (r.resource_type || '').toUpperCase(),
      }
    }
  }));

  for (let i = 0; i < globalPuts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.resourcesTable]: globalPuts.slice(i, i + 25) }
    }));
  }

  // 2) Links curso → recurso (mapeo M:N)
  const relPuts = items.map((r, idx) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `RES#${r.slug}`,
        etype: 'COURSE_RESOURCE',
        courseId,
        slug: r.slug,
        relation: 'supplementary',
        position: idx + 1,
        // denormalización útil:
        resource_type: r.resource_type,
        title: r.title,
        createdAt: new Date().toISOString(),
      }
    }
  }));

  for (let i = 0; i < relPuts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.coursesTable]: relPuts.slice(i, i + 25) }
    }));
  }

  return { created: items.length, linked: items.length };
};
