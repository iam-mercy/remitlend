import { apiClient } from './apiClient';

export type NotificationStatus = 'unread' | 'read';

export interface Notification {
  id: string;
  title: string;
  body?: string;
  status: NotificationStatus;
  action_url?: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
  page: number;
  page_size: number;
}

export interface NotificationListParams {
  page?: number;
  page_size?: number;
  status?: NotificationStatus;
}

/**
 * Bounded pagination limits to keep resource usage predictable and avoid
 * unbounded polling / oversized payloads from the notifications API.
 */
export const NOTIFICATION_PAGE_SIZE_DEFAULT = 20;
export const NOTIFICATION_PAGE_SIZE_MAX = 100;

function clampPageSize(pageSize?: number): number {
  if (pageSize === undefined || pageSize === null || Number.isNaN(pageSize)) {
    return NOTIFICATION_PAGE_SIZE_DEFAULT;
  }
  const floored = Math.floor(pageSize);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, NOTIFICATION_PAGE_SIZE_MAX);
}

function clampPage(page?: number): number {
  if (page === undefined || page === null || Number.isNaN(page)) {
    return 1;
  }
  const floored = Math.floor(page);
  return floored < 1 ? 1 : floored;
}

/**
 * Normalizes a notification coming from the server so that read state is
 * always derived from the authoritative `status` field. Unknown or missing
 * statuses are treated as `unread` to fail safe (never silently mark read).
 */
export function normalizeNotification(raw: Partial<Notification> & { id: string }): Notification {
  const status: NotificationStatus = raw.status === 'read' ? 'read' : 'unread';
  return {
    id: raw.id,
    title: raw.title ?? '',
    body: raw.body,
    status,
    action_url: raw.action_url ?? null,
    created_at: raw.created_at ?? '',
  };
}

/**
 * Derives the unread count from an authoritative list of notifications.
 * Client state is treated as a cache; this is the single source of truth
 * used to reconcile the UI after every refetch.
 */
export function countUnread(notifications: Notification[]): number {
  let count = 0;
  for (const n of notifications) {
    if (n.status === 'unread') {
      count += 1;
    }
  }
  return count;
}

/**
 * Reconciles a cached notification list against a freshly fetched authoritative
 * page. Server read state wins; local optimistic entries are dropped once the
 * server has acknowledged them. Returns a new array (no mutation).
 */
export function reconcileNotifications(
  cached: Notification[],
  authoritative: Notification[],
): Notification[] {
  const byId = new Map<string, Notification>();
  for (const n of cached) {
    byId.set(n.id, n);
  }
  for (const n of authoritative) {
    byId.set(n.id, normalizeNotification(n));
  }
  return Array.from(byId.values());
}

export const notificationService = {
  async list(params: NotificationListParams = {}): Promise<NotificationListResponse> {
    const page = clampPage(params.page);
    const page_size = clampPageSize(params.page_size);
    const query: Record<string, string | number> = { page, page_size };
    if (params.status) {
      query.status = params.status;
    }
    const response = await apiClient.get<NotificationListResponse>('/notifications', {
      params: query,
    });
    const items = (response.data.items ?? []).map((n) => normalizeNotification(n));
    return {
      items,
      total: response.data.total ?? items.length,
      page: response.data.page ?? page,
      page_size: response.data.page_size ?? page_size,
    };
  },

  async markRead(id: string): Promise<Notification> {
    if (!id) {
      throw new Error('notificationService.markRead: id is required');
    }
    const response = await apiClient.post<Notification>(`/notifications/${encodeURIComponent(id)}/read`);
    return normalizeNotification(response.data);
  },

  async markAllRead(): Promise<{ updated: number }> {
    const response = await apiClient.post<{ updated: number }>('/notifications/read-all');
    return { updated: response.data.updated ?? 0 };
  },
};

export default notificationService;
