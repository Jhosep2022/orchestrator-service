import { generateResources as aiGenerateResources } from "../ai/index.js";

export const handler = async (event) => {
  const { outline, lessons } = event || {};
  const input = { course: { ...outline?.course, modules: outline?.modules, lessons: lessons?.items } };

  const raw = await aiGenerateResources({ course: input });

  const items = Array.isArray(raw?.resources)
    ? raw.resources.map((r, idx) => ({
        slug: r.slug || `resource-${idx + 1}`,
        title: r.title || `Recurso ${idx + 1}`,
        resourceType: (r.resource_type || r.resourceType || "article").toLowerCase(),
        durationMinutes: Number(r.duration_minutes || r.durationMinutes || 5),
        description: r.description || "",
        overview: r.overview || "",
        actionLabel: r.action_label || r.actionLabel || "Ir al recurso",
        actionUrl: r.action_url || r.actionUrl || null,
        tags: Array.isArray(r.tags) ? r.tags : [],
        lessonId: r.lesson_id || r.lessonId || null,
      }))
    : [];

  return { resources: { items } };
};
