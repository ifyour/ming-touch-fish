import { getAuth } from './auth';
import type { Bindings } from './types';

export interface SessionUser {
  id: string;
  name?: string;
  email?: string;
  image?: string;
}

// 从请求头（better-auth 写入的 session cookie）解析当前登录用户。
// 未登录或解析失败返回 null，由调用方决定回退到匿名（localStorage）逻辑。
export async function getSessionUser(env: Bindings, request: Request): Promise<SessionUser | null> {
  const auth = getAuth(env.DB);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? undefined,
  };
}

// 后台鉴权：仅允许 GitHub 用户名为 ADMIN_GITHUB_LOGIN（默认 ifyour）的用户访问。
// 未登录或非管理员返回 null；调用方据此返回 401。
export function getAdminLogin(): string {
  return process.env.ADMIN_GITHUB_LOGIN ?? 'ifyour';
}

export function isAdminLogin(name: string | undefined): boolean {
  if (!name) return false;
  return name === getAdminLogin();
}

export async function requireAdmin(env: Bindings, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (!user) return null;
  if (!isAdminLogin(user.name)) return null;
  return user;
}
