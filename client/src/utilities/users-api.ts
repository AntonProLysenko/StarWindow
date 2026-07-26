import sendRequest from './send-request';
import type {
  AuthUser,
  LoginCredentials,
  SignUpData,
  UpdateCurrentUserData,
  UserLevelSummary,
  UserPointHistoryItem,
} from './users-service';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const BASE_URL = `${API_BASE}/api/users`;

export function signUp(userData: SignUpData): Promise<string> {
  return sendRequest(BASE_URL, 'POST', userData);
}

export function login(credentials: LoginCredentials): Promise<string> {
  return sendRequest(`${BASE_URL}/login`, 'POST', credentials);
}

export function checkToken(): Promise<string> {
  return sendRequest(`${BASE_URL}/check-token`);
}

export function getCurrentUser(): Promise<AuthUser> {
  return sendRequest(`${BASE_URL}/me`);
}

export function getUserLevel(): Promise<UserLevelSummary> {
  return sendRequest(`${BASE_URL}/level`);
}

export function getUserPointHistory(limit?: number): Promise<UserPointHistoryItem[]> {
  const params = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return sendRequest(`${BASE_URL}/points/history${params}`);
}

export function updateCurrentUser(userData: UpdateCurrentUserData): Promise<string> {
  return sendRequest(`${BASE_URL}/me`, 'PUT', userData);
}

export function getUserEventTypes(): Promise<{ eventTypeIds: number[] }> {
  return sendRequest(`${BASE_URL}/event-types`);
}

export function saveEventTypes(eventTypeIds: number[]): Promise<{ eventTypeIds: number[] }> {
  return sendRequest(`${BASE_URL}/event-types`, 'PUT', { eventTypeIds });
}
