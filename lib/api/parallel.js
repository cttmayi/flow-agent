// lib/api/parallel.js
export function createParallel() {
  return async (tasks, opts = {}) => {
    const { concurrency = 5, failFast = true } = opts;
    const results = new Array(tasks.length);
    let rejected = false;
    let aborted = false;
    let nextIndex = 0;
    let completed = 0;

    return new Promise((resolve, reject) => {
      function runTask(index) {
        tasks[index]()
          .then(result => { results[index] = result; })
          .catch(err => {
            if (failFast) {
              rejected = true;
              aborted = true;
              reject(err);
              return;
            }
            results[index] = err;
          })
          .finally(() => {
            completed++;
            if (completed === tasks.length) {
              resolve(results);
              return;
            }
            if (!aborted && !rejected) scheduleNext();
          });
      }

      function scheduleNext() {
        while (
          nextIndex < tasks.length &&
          nextIndex - completed < concurrency &&
          !(rejected || aborted)
        ) {
          const idx = nextIndex++;
          runTask(idx);
        }
      }

      scheduleNext();
    });
  };
}