import { generateLessons as aiGenerateLessons } from "../ai/index.js";

export const handler = async (event) => {
  const { outline, lessons } = event || {};
  const input = { course: { ...outline?.course, modules: outline?.modules, lessons: lessons?.items } };

  const raw = await aiGenerateLessons({ course: input });

  const items = Array.isArray(raw?.lessons)
    ? raw.lessons.map((l, idx) => ({
        id: l.id || lessons?.items?.[idx]?.id || `l_${idx + 1}`,
        moduleId: l.moduleId || lessons?.items?.[idx]?.moduleId,
        title: l.title || lessons?.items?.[idx]?.title || `Lección ${idx + 1}`,
        durationMinutes: Number(l.durationMinutes || l.duration_minutes || lessons?.items?.[idx]?.durationMinutes || 10),
        contentMD: l.contentMD || l.content || "",
        tips: Array.isArray(l.tips) ? l.tips : [],
        miniChallenge: l.miniChallenge || l.challenge || "",
        order: Number(l.order || lessons?.items?.[idx]?.order || idx + 1),
      }))
    : [];

  return { lessons: { items } };
};
