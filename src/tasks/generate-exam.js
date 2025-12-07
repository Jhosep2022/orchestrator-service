// src/tasks/generate-exam.js
import { generateExam as aiGenerateExam } from "../ai/index.js";
import { randomUUID } from "crypto";

const isUUID = (s) => typeof s === "string" && s.includes("-") && s.length >= 32;

export const handler = async (event) => {
  const { outline, lessons } = event || {};

  const courseFromOutline =
    outline?.course ||
    outline?.outline?.course ||
    {};

  const modulesFromOutline =
    outline?.modules ||
    outline?.outline?.modules ||
    [];

  const lessonsFromEvent =
    lessons?.lessons?.items ||
    outline?.lessons?.items ||
    lessons?.items ||
    [];

  const inputCourse = {
    ...courseFromOutline,
    modules: modulesFromOutline,
    lessons: lessonsFromEvent,
  };

  const raw = await aiGenerateExam({
    course: inputCourse,
    ctx: {
      requestId: event?.requestId,
      userId: event?.userId,
    },
  });

  const ex = raw?.exam || {};
  const items = (ex.questions || []).map((q, i) => {
    const id = isUUID(q.id) ? q.id : (q.id || randomUUID());

    const options = Array.isArray(q.options)
      ? q.options.map((op) => ({
          key: op.key || op.option || "",
          label: op.label || "",
          isCorrect: !!op.isCorrect,
          feedback: op.feedback || "",
        }))
      : [];

    const derivedKeys = options.filter((o) => o.isCorrect).map((o) => o.key);
    const answerKeys =
      Array.isArray(q.answerKeys) && q.answerKeys.length
        ? q.answerKeys
        : derivedKeys;

    return {
      id,
      position: Number(q.position || i + 1),
      prompt: q.prompt || q.question || "",
      options,
      answerKeys,
    };
  });

  const meta = {
    id: isUUID(ex.id) ? ex.id : ex.id || "ex_1",
    title: ex.title || "Examen final",
    mode: ex.mode || "final",
    timeLimitMinutes: Number(ex.timeLimitMinutes || 0),
  };

  const answerSheet = items.map((q) => ({
    id: q.id,
    answerKeys: q.answerKeys,
  }));

  return { exam: { items, meta, answerSheet } };
};
