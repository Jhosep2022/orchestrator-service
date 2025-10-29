import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const courseId = event.outline.course.id;
  const table = env.resourcesTableName;

  const puts = event.resources.items.map((r, i) => ({
    PutRequest: {
      Item: {
        PK: `RES#GLOBAL`,                 // biblioteca global
        SK: `RES#${r.slug}`,
        etype: 'LEARNING_RESOURCE',
        slug: r.slug,
        title: r.title,
        resource_type: r.resource_type,
        duration_minutes: r.duration_minutes,
        description: r.description,
        is_published: true,
        createdAt: new Date().toISOString(),
        // denormalización útil:
        GSI1PK: 'TYPE#RESOURCE',
        GSI1SK: r.resource_type.toUpperCase()
      }
    }
  }));

  // Guardar recursos globales
  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    await doc.send(new BatchWriteCommand({ RequestItems: { [table]: chunk } }));
  }

  // Relación curso → recurso (en tabla transaccional)
  const rels = event.resources.items.map((r, idx) => ({
    PutRequest: {
      Item: {
        PK: `UC#${userId}#${courseId}`,
        SK: `RES_LINK#${r.slug}`,
        etype: 'COURSE_RESOURCE',
        slug: r.slug,
        relation: 'supplementary',
        position: idx + 1
      }
    }
  }));
  for (let i = 0; i < rels.length; i += 25) {
    const chunk = rels.slice(i, i + 25);
    await doc.send(new BatchWriteCommand({ RequestItems: { [env.tableName]: chunk } }));
  }

  return { created: puts.length, linked: rels.length };
};
