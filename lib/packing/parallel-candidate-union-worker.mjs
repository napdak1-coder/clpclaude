import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("parallel-candidate-union-worker must run in a worker thread");
}

const { pack } = await import("./algorithm.ts");

parentPort.on("message", (message) => {
  try {
    const {
      id,
      cargoes,
      mode,
      options,
      candidateSet,
      sortStrategy,
      containerOrder,
      placementMode,
      autoConsolidateCompleted,
      longAxisAnchorEnabled,
    } = message;

    const runOptions = {
      ...(options ?? {}),
      fixedContainers: candidateSet,
      sortStrategy,
      containerOrder,
      placementMode,
      autoConsolidateCompleted,
    };

    if (longAxisAnchorEnabled === true) {
      runOptions.longAxisAnchor = {
        ...(runOptions.longAxisAnchor ?? {}),
        enabled: true,
      };
    }

    const result = pack(cargoes, mode, runOptions);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id: message?.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
