import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Attachment } from '../../../src/shared/ipc.types';
import { atomicWriteFile } from './atomic-file';

/** Preserve the exact input, including whitespace, as a UTF-8 workspace file. */
export async function saveChatTextAttachment(folderPath: string, content: string): Promise<Attachment> {
  if (typeof content !== 'string' || !content.trim()) throw new Error('文本附件内容为空');
  const name = `输入文本-${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
  const filePath = path.join(path.resolve(folderPath), 'uploads', 'chat-attachments', name);
  await atomicWriteFile(filePath, content);
  return { type: 'txt', name, path: filePath };
}

/** Copy chat attachments into the project before their paths reach the Agent. */
export async function stageChatAttachments(
  folderPath: string,
  attachments?: Attachment[],
): Promise<Attachment[] | undefined> {
  if (!attachments || attachments.length === 0) return attachments;

  const projectPath = path.resolve(folderPath);
  const uploadsDir = path.join(projectPath, 'uploads', 'chat-attachments');
  await fs.mkdir(uploadsDir, { recursive: true });

  const staged: Attachment[] = [];
  for (const attachment of attachments) {
    if (!attachment.path) {
      throw new Error(`附件“${attachment.name}”没有可读取的本地路径`);
    }

    try {
      const sourcePath = path.resolve(attachment.path);
      const relativeToProject = path.relative(projectPath, sourcePath);
      const isInsideProject = relativeToProject !== ''
        && !relativeToProject.startsWith(`..${path.sep}`)
        && relativeToProject !== '..'
        && !path.isAbsolute(relativeToProject);
      const sourceStat = await fs.stat(sourcePath);
      if (!sourceStat.isFile()) throw new Error('不是普通文件');

      if (isInsideProject) {
        staged.push({ ...attachment, path: sourcePath });
        continue;
      }

      const safeName = path.basename(attachment.name || attachment.path)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
      const destinationPath = path.join(
        uploadsDir,
        `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName || 'attachment'}`,
      );
      await fs.copyFile(sourcePath, destinationPath);
      staged.push({ ...attachment, path: destinationPath });
    } catch (error) {
      throw new Error(
        `附件“${attachment.name}”复制到项目失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return staged;
}
