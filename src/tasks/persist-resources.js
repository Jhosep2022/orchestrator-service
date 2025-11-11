// src/tasks/persist-resources.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

const pad = (n) => String(n).padStart(6, '0');

export const handler = async (event) => {
  console.log('[RES][persist] event keys:', Object.keys(event));
  console.log('[RES][persist] env.resourcesTable =', env.resourcesTable);
  console.log('[RES][persist] env vars snapshot:', {
    RESOURCES_TABLE_NAME: process.env.RESOURCES_TABLE_NAME,
    STAGE: process.env.STAGE,
  });

  const items    = event?.resources?.items || [];
  const courseId = event?.outline?.course?.id;
  const userId   = event?.userId || event?.outline?.userId || event?.outline?.course?.ownerId;

  console.log('[RES][persist] counts:', {
    items: items.length, courseId, userId
  });

  if (!Array.isArray(items) || items.length === 0) return { upserts: 0 };
  if (!courseId) throw new Error('COURSE_ID_REQUIRED_FOR_RESOURCES');
  if (!userId)   throw new Error('USER_ID_REQUIRED_FOR_RESOURCES');

  let upserts = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const now = new Date().toISOString();

    const slug            = r.slug;
    const lessonId        = r.lessonId ?? r.lesson_id ?? null;
    const resourceType    = r.resource_type ?? r.resourceType ?? 'article';
    const durationMinutes = r.duration_minutes ?? r.durationMinutes ?? 0;
    const title           = r.title ?? 'Resource';
    const description     = r.description ?? '';
    const overview        = r.overview ?? null;
    const actionUrl       = r.action_url ?? r.actionUrl ?? null;

    if (!slug) {
      errors.push({ index: i, code: 'MISSING_SLUG' });
      continue;
    }

    const Key = {
      PK: `USER#${userId}`,
      SK: `RES#${courseId}#${slug}`,
    };

    const g1pk = `UCOURSE#${userId}#${courseId}`;
    const g1sk = `POS#${pad(i + 1)}#${slug}`;

    // Solo calcular GSI2 si hay lessonId
    const hasG2 = !!lessonId;
    const g2pk = hasG2 ? `ULESSON#${userId}#${courseId}#${lessonId}` : undefined;
    const g2sk = hasG2 ? `POS#${pad(i + 1)}#${slug}` : undefined;

    // Nombres SIEMPRE usados
    const exprNames = {
      '#etype': 'etype',
      '#title': 'title',
      '#desc':  'description',
      '#rtype': 'resourceType',
      '#mins':  'durationMinutes',
      '#ovw':   'overview',
      '#aurl':  'actionUrl',
      '#pos':   'position',
      '#uid':   'userId',
      '#cid':   'courseId',
      '#lid':   'lessonId',
      '#ca':    'createdAt',
      '#ua':    'updatedAt',
      '#g1pk':  'GSI1PK',
      '#g1sk':  'GSI1SK',
      // NO metas #g2pk/#g2sk aquí si no se usan:
      ...(hasG2 ? { '#g2pk': 'GSI2PK', '#g2sk': 'GSI2SK' } : {})
    };

    const parts = [
      '#etype = if_not_exists(#etype, :etype)',
      '#uid   = :uid',
      '#cid   = :cid',
      '#lid   = :lid',
      '#pos   = :pos',
      '#title = :title',
      '#desc  = :desc',
      '#rtype = :rtype',
      '#mins  = :mins',
      '#ovw   = :ovw',
      '#aurl  = :aurl',
      '#ua    = :now',
      '#ca    = if_not_exists(#ca, :now)',
      '#g1pk  = :g1pk',
      '#g1sk  = :g1sk'
    ];
    if (hasG2) parts.push('#g2pk = :g2pk', '#g2sk = :g2sk');

    const UpdateExpression = `SET ${parts.join(', ')}`;

    const exprValues = {
      ':etype': 'RESOURCE',
      ':uid': userId,
      ':cid': courseId,
      ':lid': lessonId ?? null,
      ':pos': i + 1,
      ':title': title,
      ':desc': description,
      ':rtype': resourceType,
      ':mins': durationMinutes,
      ':ovw': overview,
      ':aurl': actionUrl,
      ':now': now,
      ':g1pk': g1pk,
      ':g1sk': g1sk,
      ...(hasG2 ? { ':g2pk': g2pk, ':g2sk': g2sk } : {})
    };

    console.log('[RES][persist][item]', i, { slug, lessonId, resourceType, durationMinutes, title });
    console.log('[RES][persist][ddb-update]', {
      TableName: env.resourcesTable, Key, g1pk, g1sk, g2pk, g2sk
    });

    try {
      await doc.send(new UpdateCommand({
        TableName: env.resourcesTable,
        Key,
        UpdateExpression,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'NONE'
      }));
      upserts++;
    } catch (e) {
      console.error('[RES][persist][ERR-update]', {
        index: i, slug, name: e.name, message: e.message, code: e.$metadata?.httpStatusCode || e.code
      });
      errors.push({
        index: i,
        slug,
        name: e.name,
        message: e.message,
        code: e.$metadata?.httpStatusCode || e.code
      });
    }
  }

  console.log('[RES][persist] DONE =>', { upserts, errorsCount: errors.length });
  return { upserts, errors };
};
