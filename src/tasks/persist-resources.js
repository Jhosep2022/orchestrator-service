// src/tasks/persist-resources.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

const pad = (n) => String(n).padStart(6, '0');

function resolveOutline(evt) {
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course || o1.modules) return o1;
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline;
  return { course: null, modules: [] };
}

export const handler = async (event) => {
  // -------- logs útiles
  console.log('[RES][persist] event keys:', Object.keys(event || {}));
  console.log('[RES][persist] env.resourcesTable =', env.resourcesTable);
  if (!env.resourcesTable) {
    throw new Error('ENV_MISSING: RESOURCES_TABLE_NAME no definido');
  }

  // -------- items soportando múltiples formas
  const items =
    event?.resources?.items ||
    event?.resources?.resources?.items ||
    event?.resources ||
    [];

  const { course } = resolveOutline(event);
  const courseId = course?.id;
  const userId   = event?.userId || event?.outline?.userId || course?.ownerId;

  console.log('[RES][persist] counts:', {
    items: Array.isArray(items) ? items.length : 0, courseId, userId
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
    const resourceType    = r.resourceType ?? r.resource_type ?? 'article';
    const durationMinutes = Number(r.durationMinutes ?? r.duration_minutes ?? 0);
    const title           = r.title ?? 'Resource';
    const description     = r.description ?? '';
    const overview        = r.overview ?? null;
    const actionUrl       = r.actionUrl ?? r.action_url ?? null;

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

    const hasG2 = !!lessonId;
    const g2pk = hasG2 ? `ULESSON#${userId}#${courseId}#${lessonId}` : undefined;
    const g2sk = hasG2 ? `POS#${pad(i + 1)}#${slug}` : undefined;

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
