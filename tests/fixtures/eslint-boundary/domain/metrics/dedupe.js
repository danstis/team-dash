export const dedupeByGid = (tasks) =>
  Array.from(new Map(tasks.map((task) => [task.gid, task])).values());
