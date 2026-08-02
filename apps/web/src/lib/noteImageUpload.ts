const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Whether this note has opted out of automatic image uploads. */
export function isImageAutoUploadEnabled(content: string): boolean {
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (!frontmatter) return true;
  return !/^\s*image-auto-upload\s*:\s*(?:false|["']false["'])\s*(?:#.*)?$/im.test(frontmatter);
}

/** Restrict automatic uploads to the image formats the vault can serve and render. */
export function isSupportedPastedImage(file: File): boolean {
  return file.type.toLowerCase() in PASTED_IMAGE_EXTENSIONS;
}

/** Clipboard images often have a generic or mismatched filename; use a MIME-correct vault name. */
export function pastedImageFileName(file: File): string {
  const extension = PASTED_IMAGE_EXTENSIONS[file.type.toLowerCase()];
  return `pasted-image-${Date.now()}.${extension ?? 'png'}`;
}
