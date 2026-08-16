import type { Artifact } from '../../../../src/shared/ipc.types';
import { messageHub } from '../message-hub';
import log from 'electron-log/main';

/** Push an artifact to the frontend */
export function pushArtifact(
  projectId: string,
  type: Artifact['type'],
  title: string,
  content: string,
  width = 400,
  height = 300,
  sourcePath?: string,
): Artifact {
  const artifact: Artifact = {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    content,
    path: sourcePath,
    width,
    height,
    timestamp: Date.now(),
  };
  log.info('[Agent] Pushing artifact:', artifact.id, type, title);
  messageHub.pushArtifact(projectId, artifact);
  return artifact;
}
