import { loadLockedChangeSurfaceArtifact } from "./change-surface-lock.js";
import type { TaskResumeCapsule } from "./task-state-contract.js";

export async function hydrateTaskResumeCapsule(
  rootPath: string,
  capsule: TaskResumeCapsule,
): Promise<TaskResumeCapsule> {
  if (!capsule.changeSurfaceArtifact) return capsule;
  const changeSurface = await loadLockedChangeSurfaceArtifact(
    rootPath,
    capsule.taskId,
    capsule.changeSurfaceArtifact,
  );
  const {
    changeSurfaceArtifact: _changeSurfaceArtifact,
    ...withoutArtifactReference
  } = capsule;
  return { ...withoutArtifactReference, changeSurface };
}
