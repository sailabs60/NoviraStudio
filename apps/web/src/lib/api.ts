import axios, { AxiosError } from 'axios';
import type {
  AuthResponse,
  CatalogCategoryDto,
  CatalogItemDto,
  CatalogQuery,
  CollectionDto,
  PlanDetailDto,
  PlanDto,
  ProjectDto,
  SessionUser,
  TemplateDto,
  TextureAssetDto,
} from '@novira/shared';

const TOKEN_KEY = 'novira.token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private browsing — the session simply will not persist */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to do */
    }
  },
};

export const http = axios.create({ baseURL: '/api', timeout: 120_000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** A structured error the UI can branch on, rather than a raw Axios failure. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

http.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ error?: { code: string; message: string; details?: unknown } }>) => {
    const payload = error.response?.data?.error;
    const status = error.response?.status ?? 0;
    // 401 anywhere means the stored token is no longer usable.
    if (status === 401) tokenStore.clear();
    throw new ApiClientError(
      status,
      payload?.code ?? (status === 0 ? 'NETWORK' : 'UNKNOWN'),
      payload?.message ??
        (status === 0 ? 'Cannot reach the server. Check your connection.' : 'Something went wrong.'),
      payload?.details
    );
  }
);

/* ── Auth ──────────────────────────────────────────────────────────────── */

export const api = {
  auth: {
    register: (body: Record<string, unknown>) =>
      http.post<AuthResponse>('/auth/register', body).then((r) => r.data),
    login: (email: string, password: string) =>
      http.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
    me: () => http.get<SessionUser>('/auth/me').then((r) => r.data),
    updateMe: (body: Partial<Pick<SessionUser, 'displayName' | 'preferredUnits' | 'appearance'>>) =>
      http.patch<SessionUser>('/auth/me', body).then((r) => r.data),
    changePassword: (currentPassword: string, newPassword: string) =>
      http.post('/auth/me/password', { currentPassword, newPassword }).then((r) => r.data),
    forgot: (email: string) => http.post('/auth/forgot', { email }).then((r) => r.data),
    reset: (token: string, password: string) =>
      http.post('/auth/reset', { token, password }).then((r) => r.data),
    verify: (token: string) => http.post('/auth/verify', { token }).then((r) => r.data),
    resendVerification: () => http.post('/auth/verification/resend').then((r) => r.data),
  },

  projects: {
    list: () => http.get<{ items: ProjectDto[] }>('/projects').then((r) => r.data.items),
    get: (id: number) => http.get<ProjectDto>(`/projects/${id}`).then((r) => r.data),
    create: (title: string, description?: string) =>
      http.post<ProjectDto>('/projects', { title, description }).then((r) => r.data),
    update: (id: number, body: { title?: string; description?: string | null }) =>
      http.patch<ProjectDto>(`/projects/${id}`, body).then((r) => r.data),
    remove: (id: number) => http.delete(`/projects/${id}`).then((r) => r.data),
  },

  plans: {
    listByProject: (projectId: number) =>
      http.get<{ items: PlanDto[] }>('/plans', { params: { project_id: projectId } }).then((r) => r.data.items),
    get: (id: number) => http.get<PlanDetailDto>(`/plans/${id}`).then((r) => r.data),
    create: (projectId: number, title: string, editorType: '3d' | '2d' = '3d') =>
      http.post<PlanDto>('/plans', { projectId, title, editorType }).then((r) => r.data),
    save: (id: number, body: { scene?: unknown; title?: string; previewDataUrl?: string }) =>
      http.patch<PlanDto>(`/plans/${id}`, body).then((r) => r.data),
    remove: (id: number) => http.delete(`/plans/${id}`).then((r) => r.data),
  },

  catalog: {
    categories: () =>
      http.get<{ items: CatalogCategoryDto[] }>('/catalog/categories').then((r) => r.data.items),
    items: (query: CatalogQuery) =>
      http
        .get<{ items: CatalogItemDto[]; total: number; hasMore: boolean }>('/catalog/items', { params: query })
        .then((r) => r.data),
    byIds: (ids: number[]) =>
      ids.length
        ? http
            .get<{ items: CatalogItemDto[] }>('/catalog/items/by-ids', { params: { ids: ids.join(',') } })
            .then((r) => r.data.items)
        : Promise.resolve([]),
  },

  textures: {
    categories: () =>
      http.get<{ items: { id: number; slug: string; name: string }[] }>('/textures/categories').then((r) => r.data.items),
    list: (params: { categoryId?: number; q?: string; limit?: number; offset?: number }) =>
      http.get<{ items: TextureAssetDto[]; total: number }>('/textures/assets', { params }).then((r) => r.data),
  },

  templates: {
    list: () => http.get<{ items: TemplateDto[] }>('/templates').then((r) => r.data.items),
    create: (body: { title: string; description?: string; scope: 'local' | 'global'; planId: number }) =>
      http.post<TemplateDto>('/templates', body).then((r) => r.data),
    apply: (id: number, planId: number) =>
      http.post<{ scene: unknown }>(`/templates/${id}/apply-to-plan`, { planId }).then((r) => r.data),
    remove: (id: number) => http.delete(`/templates/${id}`).then((r) => r.data),
  },

  collections: {
    list: () => http.get<{ items: CollectionDto[] }>('/collections').then((r) => r.data.items),
    create: (body: { name: string; objects: unknown[]; previewDataUrl?: string; sourcePlanId?: number }) =>
      http.post<CollectionDto>('/collections', body).then((r) => r.data),
    get: (id: number) => http.get<{ objects: unknown[] }>(`/collections/${id}`).then((r) => r.data),
    remove: (id: number) => http.delete(`/collections/${id}`).then((r) => r.data),
  },
};
