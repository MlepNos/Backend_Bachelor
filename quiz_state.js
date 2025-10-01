// quiz_state.js
import fs from "fs";
const base = "./quiz_memory";

export function getState(course) {
  const file = `${base}/${course}.json`;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file));
}

export function setState(course, state) {
  fs.mkdirSync(base, { recursive: true });
  const file = `${base}/${course}.json`;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

export function clearState(course) {
  const file = `${base}/${course}.json`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
