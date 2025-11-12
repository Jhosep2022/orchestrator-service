import { generateExam as aiGenerateExam } from "../ai/index.js";

export const handler = async (event) => {
  const { outline, lessons } = event || {};
  const input = { course: { ...outline?.course, modules: outline?.modules, lessons: lessons?.items } };

  const raw = await aiGenerateExam({ course: input });

  const ex = raw?.exam || {};
  const items = (ex.questions || []).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    prompt: q.prompt || q.question || "",
    options: (q.options || []).map((op) => ({
      key: op.key || op.option || "",
      label: op.label || "",
      isCorrect: !!op.isCorrect,
      feedback: op.feedback || "",
    })),
    position: Number(q.position || i + 1),
  }));

  const meta = {
    id: ex.id || "ex_1",
    title: ex.title || "Examen final",
    mode: ex.mode || "final",
    timeLimitMinutes: Number(ex.timeLimitMinutes || 0),
  };

  return { exam: { items, meta } };
};
