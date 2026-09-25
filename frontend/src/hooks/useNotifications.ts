import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Notification center read-state consistency.
 *
 * The server is the authoritative source of read state. Client state is a
 * cache that reconciles on every refetch: unread counts and per-item read
 * flags are always derived from the latest server response, never from
 * optimistic local mutations that could drift.
 */

export type NotificationStatus = 'unread' | 'read';

export interface Notification {
  id: string;
  title: string;
  body?: string;
  status: NotificationStatus;
  action_url?: string | null;
  created_at: string;
}

export interface NotificationsPage {
  items: Notification[];
  next_cursor: string | null;
  unread_count: number;
}

export interface UseNotificationsOptions {
  /** Bounded page size; clamped to [1, MAX_PAGE_SIZE]. */
  pageSize?: number;
  /** Disable fetching (e.g. when the panel is closed). */
  enabled?: boolean;
}

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isMarkingRead: boolean;
  error: string | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPageSize(size: number | undefined): number {
  if (!Number.isFinite(size) || size === undefined) return DEFAULT_PAGE_SIZE;
  const n = Math.floor(size);
  if (n < 1) return 1;
  if (n > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return n;
}

function isValidNotification(value: unknown): value is Notification {
  if (typeof value !== 'object' || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    (n.status === 'read' || n.status === 'unread') &&
    typeof n.created_at === 'string'
  );
}

function parsePage(payload: unknown): NotificationsPage {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Malformed notifications response');
  }
  const p = payload as Record<string, unknown>;
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items = rawItems.filter(isValidNotification);
  const nextCursor =
    typeof p.next_cursor === 'string' && p.next_cursor.length > 0 ? p.next_cursor : null;
  const unreadCount =
    typeof p.unread_count === 'number' && Number.isFinite(p.unread_count) && p.unread_count >= 0
      ? Math.floor(p.unread_count)
      : items.filter((n) => n.status === 'unread').length;
  return { items, next_cursor: nextCursor, unread_count: unreadCount };
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Notifications request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Reconcile a single item's read state from an authoritative server response.
 * Returns the previous array when nothing changed to avoid needless renders.
 */
function reconcileItem(
  items: Notification[],
  id: string,
  status: NotificationStatus,
): Notification[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id || item.status === status) return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? next : items;
}

export function useNotifications(
  options: UseNotificationsOptions = {},
): UseNotificationsResult {
  const { enabled = true } = options;
  const pageSize = useMemo(() => clampPageSize(options.pageSize), [options.pageSize]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against overlapping fetches and stale responses overwriting fresh data.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const payload = await requestJson(
        `/api/notifications?limit=${pageSize}`,
      );
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const page = parsePage(payload);
      setNotifications(page.items);
      setUnreadCount(page.unread_count);
      setNextCursor(page.next_cursor);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoading) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const payload = await requestJson(
        `/api/notifications?limit=${pageSize}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const page = parsePage(payload);
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const merged = prev.slice();
        for (const item of page.items) {
          if (!seen.has(item.id)) merged.push(item);
        }
        return merged;
      });
      // Unread count is authoritative from the server, not summed locally.
      setUnreadCount(page.unread_count);
      setNextCursor(page.next_cursor);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load more notifications');
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [nextCursor, isLoading, pageSize]);

  const markRead = useCallback(
    async (id: string) => {
      setIsMarkingRead(true);
      setError(null);
      try {
        await requestJson(`/api/notifications/${encodeURIComponent(id)}/read`, {
          method: 'POST',
        });
        if (!mountedRef.current) return;
        // Reconcile from the authoritative response rather than trusting the
        // optimistic local flip; refetch keeps counts consistent across tabs.
        setNotifications((prev) => reconcileItem(prev, id, 'read'));
        await fetchFirstPage();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to mark notification read');
        // On failure, re-sync so the cache cannot drift from the server.
        await fetchFirstPage();
      } finally {
        if (mountedRef.current) setIsMarkingRead(false);
      }
    },
    [fetchFirstPage],
  );

  const markAllRead = useCallback(async () => {
    setIsMarkingRead(true);
    setError(null);
    try {
      await requestJson('/api/notifications/read-all', { method: 'POST' });
      if (!mountedRef.current) return;
      setNotifications((prev) =>
        prev.map((item) =>
          item.status === 'read' ? item : { ...item, status: 'read' as const },
        ),
      );
      await fetchFirstPage();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to mark all notifications read');
      await fetchFirstPage();
    } finally {
      if (mountedRef.current) setIsMarkingRead(false);
    }
  }, [fetchFirstPage]);

  useEffect(() => {
    if (!enabled) return;
    void fetchFirstPage();
  }, [enabled, fetchFirstPage]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isMarkingRead,
    error,
    hasMore: nextCursor !== null,
    refetch: fetchFirstPage,
    loadMore,
    markRead,
    markAllRead,
  };
}
