const STORAGE_KEY = "gestor-adoraciones-admin-code";

function configuredCode(): string {
  return String(import.meta.env.VITE_ADMIN_CODE || "").trim();
}

export function verifyAdminCode(code: string): boolean {
  const configured = configuredCode();
  return Boolean(configured) && code.trim() === configured;
}

export function getAdminCode(): string {
  return window.sessionStorage.getItem(STORAGE_KEY) || "";
}

export function setAdminCode(code: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, code.trim());
}

export function clearAdminCode(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export async function requireAdminCode(existing?: string): Promise<string> {
  const cached = (existing || getAdminCode()).trim();
  if (cached && verifyAdminCode(cached)) return cached;

  const code = window.prompt("Código de aprobación:")?.trim() || "";
  if (!code) throw new Error("Se necesita el código de aprobación.");
  if (!verifyAdminCode(code)) throw new Error("Código incorrecto.");
  setAdminCode(code);
  return code;
}
