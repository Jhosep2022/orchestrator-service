// src/tasks/persist-resources.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

const pad = (n) => String(n).padStart(6, '0');

export const handler = async (event) => {
  const items    = event?.resources?.items || [];
  const courseId = event?.outline?.course?.id;
  // intenta resolver userId desde varias fuentes del orquestador
  const userId   = event?.userId
                || event?.outline?.userId
                || event?.outline?.course?.ownerId;

  if (!Array.isArray(items) || items.length === 0) {
    return { upserts: 0 };
  }
  if (!courseId) {
    throw new Error('COURSE_ID_REQUIRED_FOR_RESOURCES');
  }
  if (!userId) {
    throw new Error('USER_ID_REQUIRED_FOR_RESOURCES');
  }

  let upserts = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const now = new Date().toISOString();

    // soporta tanto snake_case (de tu generador) como camelCase
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

    // GSI1 (curso) siempre
    const g1pk = `UCOURSE#${userId}#${courseId}`;
    const g1sk = `POS#${pad(i + 1)}#${slug}`;

    // GSI2 (lección) solo si viene lessonId
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

    // si no hay lessonId, no seteamos GSI2 para no “suciar” el ítem
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

    try {
      await doc.send(new UpdateCommand({
        TableName: env.resourcesTable, // asegúrate que está definido en core/env.js
        Key,
        UpdateExpression,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      }));
      upserts++;
    } catch (e) {
      // no detenemos todo el batch: registramos y seguimos
      errors.push({
        index: i,
        slug,
        message: e.message,
        name: e.name,
      });
    }
  }

  return { upserts, errors };
};
