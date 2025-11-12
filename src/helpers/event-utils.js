export function resolveCourseId(event) {
  return (
    event?.outline?.course?.id ||
    event?.outline?.outline?.course?.id ||       // <-- tu caso
    event?.persistCourse?.courseId ||
    event?.payload?.draftCourseId ||
    event?.payload?.courseId ||
    null
  );
}