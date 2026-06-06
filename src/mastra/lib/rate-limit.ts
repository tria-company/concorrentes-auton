/**
 * Limitador de taxa simples (concorrência + intervalo mínimo entre INÍCIOS de tarefa).
 * Usado pra não estourar a cota do Gemini: a análise roda `foreach concurrency:8`, mas as
 * chamadas ao Gemini passam todas por um único limitador global (RPM controlado).
 */
export type Scheduler = <T>(fn: () => Promise<T>) => Promise<T>;

export function createRateLimiter(concurrency: number, minIntervalMs: number): Scheduler {
  const conc = Math.max(1, concurrency);
  const gap = Math.max(0, minIntervalMs);
  let active = 0;
  let nextSlot = 0; // timestamp mais cedo em que a próxima tarefa pode iniciar
  const queue: Array<() => void> = [];

  const pump = () => {
    if (active >= conc || queue.length === 0) return;
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    nextSlot = start + gap;
    active++;
    const job = queue.shift()!;
    setTimeout(job, start - now);
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          pump();
        });
      });
      pump();
    });
}
