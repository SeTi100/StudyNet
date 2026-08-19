export async function saveToOPFS(blob: Blob, directory: string, fileName: string): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const dirHandle = await root.getDirectoryHandle(directory, { create: true });
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  
  return `opfs://${directory}/${fileName}`;
}

export async function getFromOPFS(opfsUrl: string): Promise<File> {
  const parts = opfsUrl.replace('opfs://', '').split('/');
  const directory = parts[0];
  const fileName = parts.slice(1).join('/');
  
  const root = await navigator.storage.getDirectory();
  const dirHandle = await root.getDirectoryHandle(directory);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  return await fileHandle.getFile();
}

export async function deleteFromOPFS(opfsUrl: string): Promise<void> {
  const parts = opfsUrl.replace('opfs://', '').split('/');
  const directory = parts[0];
  const fileName = parts.slice(1).join('/');
  
  const root = await navigator.storage.getDirectory();
  const dirHandle = await root.getDirectoryHandle(directory);
  await dirHandle.removeEntry(fileName);
}
