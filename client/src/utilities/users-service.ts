import * as usersAPI from './users-api';

export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be at least 8 characters and include one uppercase letter, one number, and one special symbol.';

export interface AuthUser {
  user_id: number;
  email: string;
  f_name: string;
  l_name: string;
  status_id?: number | null;
  status?: string | null;
  min_points?: number | null;
  level?: UserLevelSummary | null;
}

export interface UserLevelSummary {
  user_id: number;
  status_id: number;
  status: string;
  total_points: number;
  current_level_points: number;
  next_level_points: number | null;
  points_into_level: number;
  points_to_next_level: number;
  updated_at: string | null;
}

export interface UserPointHistoryItem {
  user_point_event_history_id: string;
  user_id: number;
  action_code: string;
  display_name: string;
  points: number;
  source_type: string;
  source_key: string;
  created_at: string;
}

export interface SignUpData {
  f_name: string;
  l_name: string;
  email: string;
  password: string;
  status_id?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface UpdateCurrentUserData {
  f_name: string;
  l_name: string;
  email: string;
  current_password: string;
  new_password?: string | null;
  confirm_new_password?: string | null;
}

interface TokenPayload {
  exp?: number;
  user?: AuthUser;
}

let memoryToken: string | null = null;
const authListeners = new Set<() => void>();

export async function signUp(userData: SignUpData): Promise<AuthUser | null> {
  const token = await usersAPI.signUp(userData);
  setToken(token);
  return getUser();
}

export async function login(credentials: LoginCredentials): Promise<AuthUser | null> {
  const token = await usersAPI.login(credentials);
  setToken(token);
  return getUser();
}

export function saveEventTypes(eventTypeIds: number[]) {
  return usersAPI.saveEventTypes(eventTypeIds);
}

export function getPasswordValidationError(password: string): string | null {
  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return PASSWORD_REQUIREMENTS_MESSAGE;
  }

  return null;
}

export function getCurrentUser(): Promise<AuthUser> {
  return usersAPI.getCurrentUser();
}

export function getUserLevel(): Promise<UserLevelSummary> {
  return usersAPI.getUserLevel();
}

export function getUserPointHistory(limit?: number): Promise<UserPointHistoryItem[]> {
  return usersAPI.getUserPointHistory(limit);
}

export async function updateCurrentUser(userData: UpdateCurrentUserData): Promise<AuthUser | null> {
  const token = await usersAPI.updateCurrentUser(userData);
  setToken(token);
  return getCurrentUser().catch(() => getUser());
}

export function getUserEventTypes() {
  return usersAPI.getUserEventTypes();
}

export function getToken(): string | null {
  const token = readToken();
  if (!token) return null;

  const payload = decodeToken(token);
  if (!payload || (payload.exp && payload.exp < Date.now() / 1000)) {
    logOut();
    return null;
  }

  return token;
}

export function getUser(): AuthUser | null {
  const token = getToken();
  return token ? decodeToken(token)?.user ?? null : null;
}

export function logOut() {
  setToken(null);
}

export function subscribeAuthChanges(listener: () => void) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

export function checkToken() {
  return usersAPI.checkToken().then((dateStr) => new Date(dateStr));
}

function setToken(token: string | null) {
  memoryToken = token;

  if (typeof localStorage !== 'undefined') {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  authListeners.forEach((listener) => listener());
}

function readToken() {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('token');
  }

  return memoryToken;
}

function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(decodeBase64Url(payload)) as TokenPayload;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');

  if (typeof atob === 'function') {
    return decodeUtf8(atob(padded));
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const char of padded.replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return decodeUtf8(output);
}

function decodeUtf8(binary: string) {
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  return binary;
}
