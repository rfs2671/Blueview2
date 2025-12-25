import Constants from 'expo-constants';

const getApiUrl = () => {
  return Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';
};

export const API_URL = getApiUrl();

export const api = {
  // Workers
  getWorkers: () => fetch(`${API_URL}/api/workers`).then(r => r.json()),
  getWorker: (id: string) => fetch(`${API_URL}/api/workers/${id}`).then(r => r.json()),
  createWorker: (data: any) => fetch(`${API_URL}/api/workers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  updateWorker: (id: string, data: any) => fetch(`${API_URL}/api/workers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  deleteWorker: (id: string) => fetch(`${API_URL}/api/workers/${id}`, {
    method: 'DELETE',
  }).then(r => r.json()),

  // Projects
  getProjects: () => fetch(`${API_URL}/api/projects`).then(r => r.json()),
  getProject: (id: string) => fetch(`${API_URL}/api/projects/${id}`).then(r => r.json()),
  createProject: (data: any) => fetch(`${API_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  deleteProject: (id: string) => fetch(`${API_URL}/api/projects/${id}`, {
    method: 'DELETE',
  }).then(r => r.json()),

  // Check-ins
  createCheckin: (data: any) => fetch(`${API_URL}/api/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  checkout: (id: string) => fetch(`${API_URL}/api/checkins/${id}/checkout`, {
    method: 'POST',
  }).then(r => r.json()),
  getTodayCheckins: (projectId: string) => 
    fetch(`${API_URL}/api/checkins/project/${projectId}/today`).then(r => r.json()),
  getActiveCheckins: (projectId: string) => 
    fetch(`${API_URL}/api/checkins/project/${projectId}/active`).then(r => r.json()),
  getCheckinStats: (projectId: string) => 
    fetch(`${API_URL}/api/checkins/stats/${projectId}`).then(r => r.json()),

  // Daily Logs
  getDailyLogs: (projectId: string) => 
    fetch(`${API_URL}/api/daily-logs/project/${projectId}`).then(r => r.json()),
  getDailyLog: (id: string) => fetch(`${API_URL}/api/daily-logs/${id}`).then(r => r.json()),
  getDailyLogByDate: (projectId: string, date: string) => 
    fetch(`${API_URL}/api/daily-logs/project/${projectId}/date/${date}`).then(r => r.json()),
  createDailyLog: (data: any) => fetch(`${API_URL}/api/daily-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  updateDailyLog: (id: string, data: any) => fetch(`${API_URL}/api/daily-logs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  submitDailyLog: (id: string) => fetch(`${API_URL}/api/daily-logs/${id}/submit`, {
    method: 'POST',
  }).then(r => r.json()),
  deleteDailyLog: (id: string) => fetch(`${API_URL}/api/daily-logs/${id}`, {
    method: 'DELETE',
  }).then(r => r.json()),
};

export default api;
