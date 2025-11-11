// src/tasks/persist-resources.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

const pad = (n) => String(n).padStart(6, '0');

export const handler = async (event) => {
  // ----------- LOG DE ENTRADA -----------
  console.log('[RES][persist] event keys:', Object.keys(event || {}));
  console.log('[RES][persist] env.resourcesTable =', env?.resourcesTable);
  console.log('[RES][persist] env vars snapshot:', {
    RESOURCES_TABLE_NAME: process.env.RESOURCES_TABLE_NAME,
    STAGE: process.env.STAGE,
  });

  const items    = event?.resources?.items || [];
  const courseId = event?.outline?.course?.id;
  const userId   = event?.userId || event?.outline?.userId || event?.outline?.course?.ownerId;

  console.log('[RES][persist] counts:', { items: items.length, courseId, userId });

  if (!Array.isArray(items) || items.length === 0) {
    console.log('[RES][persist] -> no items to upsert');
    return { upserts: 0 };
  }
  if (!courseId) {
    console.error('[RES][persist][ERR] missing courseId');
    throw new Error('COURSE_ID_REQUIRED_FOR_RESOURCES');
  }
  if (!userId) {
    console.error('[RES][persist][ERR] missing userId');
    throw new Error('USER_ID_REQUIRED_FOR_RESOURCES');
  }

  let upserts = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const now = new Date().toISOString();

    // soporta snake/camel
    const slug            = r.slug;
    const lessonId        = r.lessonId ?? r.lesson_id ?? null;
    const resourceType    = r.resource_type ?? r.resourceType ?? 'article';
    const durationMinutes = r.duration_minutes ?? r.durationMinutes ?? 0;
    const title           = r.title ?? 'Resource';
    const description     = r.description ?? '';
    const overview        = r.overview ?? null;
    const actionUrl       = r.action_url ?? r.actionUrl ?? null;

    // LOG por item
    console.log('[RES][persist][item]', i, {
      slug, lessonId, resourceType, durationMinutes, title
    });

    if (!slug) {
      const err = { index: i, code: 'MISSING_SLUG' };
      console.error('[RES][persist][item-err]', err);
      errors.push(err);
      continue;
    }

    const Key = { PK: `USER#${userId}`, SK: `RES#${courseId}#${slug}` };

    // GSI1 (curso) siempre
    const g1pk = `UCOURSE#${userId}#${courseId}`;
    const g1sk = `POS#${pad(i + 1)}#${slug}`;

    // GSI2 (lección) opcional
    const g2pk = lessonId ? `ULESSON#${userId}#${courseId}#${lessonId}` : undefined;
    const g2sk = lessonId ? `POS#${pad(i + 1)}#${slug}` : undefined;

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
      '#g2pk':  'GSI2PK',
      '#g2sk':  'GSI2SK',
    };

    const setGsi2 = lessonId ? ', #g2pk = :g2pk, #g2sk = :g2sk' : '';

    const UpdateExpression = `
      SET
        #etype = if_not_exists(#etype, :etype),
        #uid   = :uid,
        #cid   = :cid,
        #lid   = :lid,
        #pos   = :pos,
        #title = :title,
        #desc  = :desc,
        #rtype = :rtype,
        #mins  = :mins,
        #ovw   = :ovw,
        #aurl  = :aurl,
        #ua    = :now,
        #ca    = if_not_exists(#ca, :now),
        #g1pk  = :g1pk,
        #g1sk  = :g1sk
        ${setGsi2}
    `.replace(/\s+/g, ' ').trim();

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
      ...(lessonId ? { ':g2pk': g2pk, ':g2sk': g2sk } : {}),
    };

    // LOG antes del update
    console.log('[RES][persist][ddb-update]', {
      TableName: env.resourcesTable,
      Key,
      g1pk, g1sk, g2pk, g2sk
    });

    try {
      const res = await doc.send(new UpdateCommand({
        TableName: env.resourcesTable,   // <-- verifica core/env.js
        Key,
        UpdateExpression,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      }));
      console.log('[RES][persist][ok]', slug, res?.$metadata);
      upserts++;
    } catch (e) {
      const err = {
        index: i,
        slug,
        name: e?.name,
        message: e?.message,
        code: e?.$metadata?.httpStatusCode,
      };
      console.error('[RES][persist][ERR-update]', err);
      errors.push(err);
    }
  }

  console.log('[RES][persist] DONE =>', { upserts, errorsCount: errors.length });
  return { upserts, errors };
};
