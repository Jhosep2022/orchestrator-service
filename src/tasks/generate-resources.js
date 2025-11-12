// src/tasks/generate-resources.js
import { generateResources as aiGenerateResources } from "../ai/index.js";

export const handler = async (event) => {
  const { outline, lessons } = event || {};
  const course = {
    ...outline?.course,
    modules: outline?.modules,
    lessons: lessons?.items || lessons || []
  };

  const raw = await aiGenerateResources({ course });

  const rawItems =
    raw?.resources?.items ||
    raw?.resources ||
    [];

  const items = Array.isArray(rawItems)
    ? rawItems.map((r, idx) => ({
        slug: r.slug || `resource-${idx + 1}`,
        title: r.title || `Recurso ${idx + 1}`,
        resourceType: (r.resourceType || r.resource_type || "article").toLowerCase(),
        durationMinutes: Number(r.durationMinutes ?? r.duration_minutes ?? 5),
        description: r.description ?? "",
        overview: r.overview ?? "",
        actionLabel: r.actionLabel ?? r.action_label ?? "Ir al recurso",
        actionUrl: r.actionUrl ?? r.action_url ?? null,
        tags: Array.isArray(r.tags) ? r.tags : [],
        lessonId: r.lessonId ?? r.lesson_id ?? null,
      }))
    : [];

  return { resources: { items } };
};
