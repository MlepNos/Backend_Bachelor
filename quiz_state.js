// quiz_state.js
import fs from "fs";
const base = "./quiz_memory";

// read quiz state for a course (or null if none saved)
export function getState(course) {
  const file = `${base}/${course}.json`;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file));
}

// persist quiz state for a course (creates folder if missing)
export function setState(course, state) {
  fs.mkdirSync(base, { recursive: true });
  const file = `${base}/${course}.json`;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

// delete saved quiz state for a course
export function clearState(course) {
  const file = `${base}/${course}.json`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
