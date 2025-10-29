export const handler = async (event) => {
  const { payload } = event;
  // TODO: LLM aquí. Por ahora mock sencillo:
  const modules = [
    { id: "m1", title: "Fundamentos de POO" },
    { id: "m2", title: "Relaciones y Principios" }
  ];
  const lessons = [
    { moduleId: "m1", id: "l1", title: "Clases y Objetos", durationMinutes: 12 },
    { moduleId: "m1", id: "l2", title: "Atributos y Métodos", durationMinutes: 15 },
    { moduleId: "l1", id: "l3", title: "Encapsulamiento", durationMinutes: 10 },
    { moduleId: "m2", id: "l4", title: "Herencia", durationMinutes: 18 },
    { moduleId: "m2", id: "l5", title: "Polimorfismo", durationMinutes: 16 },
    { moduleId: "m2", id: "l6", title: "Abstracción", durationMinutes: 14 }
  ].map((x, i) => ({ ...x, order: i + 1 }));

  return {
    course: {
      id: payload.draftCourseId,
      title: payload.title || "Curso generado",
      level: payload.level || "beginner",
      tags: payload.tags || []
    },
    modules,
    lessons
  };
};
