// Mock authentication functions
// In a real application, replace this with a proper authentication service

const AUTH_KEY = 'prodtime_tracker_auth';

interface AuthData {
  loggedIn: boolean;
  operatorName: string;
  isAdmin?: boolean;
}

export function login(operatorName: string, password_unused: string): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      let authDataToStore: AuthData | null = null;

      if (operatorName === 'Daniel' && password_unused === '1234') {
        authDataToStore = { loggedIn: true, operatorName, isAdmin: true };
      } else if (operatorName && password_unused) { // Simplified operator login
        authDataToStore = { loggedIn: true, operatorName, isAdmin: false };
      }

      if (authDataToStore && typeof window !== 'undefined') {
        localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
        resolve(true);
      } else {
        resolve(false);
      }
    }, 500); // Simulate API call
  });
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_KEY);
  }
}

export function isAuthenticated(): boolean {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        const parsedData: AuthData = JSON.parse(authDataString);
        return parsedData.loggedIn === true;
      } catch (e) {
        return false;
      }
    }
  }
  return false;
}

export function getOperatorName(): string | null {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        const parsedData: AuthData = JSON.parse(authDataString);
        return parsedData.operatorName || null;
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

export function isAdmin(): boolean {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        const parsedData: AuthData = JSON.parse(authDataString);
        return parsedData.loggedIn === true && parsedData.isAdmin === true;
      } catch (e) {
        return false;
      }
    }
  }
  return false;
}
