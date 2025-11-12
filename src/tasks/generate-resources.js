// src/tasks/generate-resources.js
import { generateResources as aiGenerateResources } from "../ai/index.js";

function resolveOutline(evt) {
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course || o1.modules) return o1;
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline;
  return { course: null, modules: [] };
}

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'resource';
}

export const handler = async (event) => {
  const { course, modules } = resolveOutline(event);
  const lessons = event?.lessons?.items || event?.lessons || [];

  const coursePayload = {
    ...course,
    modules: modules || [],
    lessons: Array.isArray(lessons) ? lessons : []
  };

  console.log('[RES][gen] course.id=', coursePayload?.id, 'mods=', (coursePayload.modules||[]).length, 'lessons=', (coursePayload.lessons||[]).length);

  let raw;
  try {
    raw = await aiGenerateResources({ course: coursePayload });
  } catch (e) {
    console.error('[RES][gen][ERR-IA]', e);
    raw = null;
  }

  const rawItems = raw?.resources?.items || raw?.resources || [];
  let items = Array.isArray(rawItems) ? rawItems : [];
  console.log('[RES][gen] IA items:', items.length);

  // Fallback si IA devuelve 0
  if (items.length === 0) {
    const bases = ['guia-intro', 'practica-basica', 'video-resumen', 'cheatsheet-poo'];
    items = bases.map((base, i) => ({
      slug: base,
      title: ['Guía Introductoria', 'Práctica Básica', 'Video Resumen', 'Cheatsheet POO'][i] || `Recurso ${i+1}`,
      resourceType: ['article', 'practice', 'video', 'cheatsheet'][i] || 'article',
      durationMinutes: [7,12,6,5][i] || 5,
      description: 'Recurso autogenerado.',
      overview: null,
      actionLabel: 'Abrir',
      actionUrl: null,
      tags: ['poo','python'],
      lessonId: coursePayload.lessons?.[i]?.id ?? null
    }));
    console.warn('[RES][gen] Aplicado Fallback de recursos:', items.length);
  }

  // Normalización final
  const normalized = items.map((r, idx) => ({
    slug: kebab(r.slug || r.title || `resource-${idx + 1}`),
    title: r.title || `Recurso ${idx + 1}`,
    resourceType: (r.resourceType || r.resource_type || "article").toLowerCase(),
    durationMinutes: Number(r.durationMinutes ?? r.duration_minutes ?? 5),
    description: r.description ?? "",
    overview: r.overview ?? "",
    actionLabel: r.actionLabel ?? r.action_label ?? "Ir al recurso",
    actionUrl: r.actionUrl ?? r.action_url ?? null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    lessonId: r.lessonId ?? r.lesson_id ?? null,
  }));

  console.log('[RES][gen] normalized:', normalized.length);
  return { resources: { items: normalized } };
};
