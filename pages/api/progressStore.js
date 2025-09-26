const progressMap = new Map();

export function setProgress(key, progress) {
  progressMap.set(key, progress);
}

export function getProgress(key) {
  return progressMap.get(key) || { current: 0, total: 0 };
}

export function clearProgress(key) {
  progressMap.delete(key);
}
