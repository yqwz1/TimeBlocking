import type { OAuth2Client } from 'google-auth-library';

export const DRIVE_BACKUP_FOLDER = 'Second Brain Backups';
export const DRIVE_BACKUP_MARKER = 'timeblock-second-brain-backup';
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  createdTime?: string | null;
  size: number | null;
  webViewLink: string | null;
}

type DriveListResponse = { files?: Array<Partial<DriveFile>>; nextPageToken?: string };

function q(value: string) {
  return encodeURIComponent(value);
}

function normalize(file: Partial<DriveFile>): DriveFile {
  return {
    id: file.id ?? '',
    name: file.name ?? 'Untitled',
    mimeType: file.mimeType ?? 'application/octet-stream',
    modifiedTime: file.modifiedTime ?? null,
    createdTime: file.createdTime ?? null,
    size: file.size == null ? null : Number(file.size),
    webViewLink: file.webViewLink ?? null,
  };
}

/** Minimal Drive v3 client built on the existing Google OAuth client. */
export class Gdrive {
  constructor(private readonly auth: OAuth2Client) {}

  private async request<T>(url: string, options: { method?: 'GET' | 'POST' | 'DELETE'; data?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await this.auth.request<T>({ url, method: options.method, data: options.data, headers: options.headers });
    return res.data;
  }

  async accountEmail(): Promise<string | null> {
    const data = await this.request<{ email?: string }>('https://www.googleapis.com/oauth2/v2/userinfo');
    return data.email ?? null;
  }

  async search(query: string, limit = 20): Promise<DriveFile[]> {
    const escaped = query.replace(/'/g, "\\'");
    const url = `https://www.googleapis.com/drive/v3/files?q=${q(`trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`)}&pageSize=${Math.min(limit, 100)}&orderBy=modifiedTime desc&fields=${q('files(id,name,mimeType,modifiedTime,size,webViewLink)')}`;
    const data = await this.request<DriveListResponse>(url);
    return (data.files ?? []).map(normalize).filter((file) => file.id);
  }

  async getFile(id: string): Promise<DriveFile> {
    return normalize(await this.request<Partial<DriveFile>>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${q('id,name,mimeType,modifiedTime,createdTime,size,webViewLink')}`));
  }

  async exportGoogleDocText(id: string): Promise<string> {
    return this.request<string>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text%2Fplain`);
  }

  async getOrCreateFolder(name: string): Promise<string> {
    const findUrl = `https://www.googleapis.com/drive/v3/files?q=${q(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&pageSize=1&fields=${q('files(id)')}`;
    const found = await this.request<DriveListResponse>(findUrl);
    if (found.files?.[0]?.id) return found.files[0].id;
    const created = await this.request<{ id: string }>('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      data: { name, mimeType: 'application/vnd.google-apps.folder' },
      headers: { 'Content-Type': 'application/json' },
    });
    return created.id;
  }

  async listBackups(folderId: string): Promise<DriveFile[]> {
    const url = `https://www.googleapis.com/drive/v3/files?q=${q(`'${folderId}' in parents and appProperties has { key='managedBy' and value='${DRIVE_BACKUP_MARKER}' } and trashed = false`)}&pageSize=100&orderBy=createdTime desc&fields=${q('files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink)')}`;
    const data = await this.request<DriveListResponse>(url);
    return (data.files ?? []).map(normalize).filter((file) => file.id);
  }

  async uploadBackup(folderId: string, name: string, bytes: Buffer): Promise<DriveFile> {
    const boundary = `timeblock-${Date.now().toString(36)}`;
    const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'application/zip', appProperties: { managedBy: DRIVE_BACKUP_MARKER } });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return normalize(await this.request<Partial<DriveFile>>('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,size,webViewLink', {
      method: 'POST', data: body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    }));
  }

  async download(id: string): Promise<Buffer> {
    const res = await this.auth.request<ArrayBuffer>({ url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }

  async deleteAppFile(id: string): Promise<void> {
    await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
