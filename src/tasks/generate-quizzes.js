import { generateQuizzes as aiGenerateQuizzes } from "../ai/index.js";

export const handler = async (event) => {
  const { outline, lessons } = event || {};
  const input = { course: { ...outline?.course, modules: outline?.modules, lessons: lessons?.items } };

  const raw = await aiGenerateQuizzes({ course: input });

  const items = Array.isArray(raw?.quizzes)
    ? raw.quizzes.map((qz) => ({
        lessonId: qz.lessonId,
        questions: (qz.questions || []).map((q, i) => ({
          id: q.id || `q${i + 1}`,
          position: Number(q.position || i + 1),
          prompt: q.prompt || q.question || "",
          options: (q.options || []).map((op) => ({
            key: op.key || op.option || "",
            label: op.label || "",
            isCorrect: !!op.isCorrect,
            feedback: op.feedback || "",
          })),
        })),
      }))
    : [];

  return { quizzes: { items } };
};
