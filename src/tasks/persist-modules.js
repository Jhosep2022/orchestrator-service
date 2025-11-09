import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { course } = event.outline;
  const courseId = course.id;
  const modules = event.outline.modules || [];

  // SK = MODULE#<position>#<moduleId>
  const puts = modules.map((m, idx) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `MODULE#${idx + 1}#${m.id}`,
        etype: 'MODULE',
        moduleId: m.id,
        position: idx + 1,
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

  return { totalModules: modules.length };
};
