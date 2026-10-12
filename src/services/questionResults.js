const USER_ID_KEY = 'psd-assessment-user-id';

function getUserId() {
  let userId = window.localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = window.crypto?.randomUUID?.() || `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

export async function getQuestionPriorities() {
  try {
    const response = await fetch(`/api/questions/priorities?userId=${encodeURIComponent(getUserId())}`);
    if (!response.ok) return {};
    const { priorities } = await response.json();
    return Object.fromEntries(priorities.map((priority) => [priority.questionId, priority]));
  } catch {
    return {};
  }
}

export async function saveQuestionResult({ questionId, mode, correct }) {
  try {
    const response = await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getUserId(), questionId, mode, correct }),
    });
    return response.ok;
  } catch {
    return false;
  }
}