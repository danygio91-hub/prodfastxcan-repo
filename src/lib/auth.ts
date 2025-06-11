// Mock authentication functions
// In a real application, replace this with a proper authentication service

const AUTH_KEY = 'prodtime_tracker_auth';

export function login(operatorName: string, password_unused: string): Promise<boolean> {
  // Mock login: any non-empty operator name is considered valid for this example
  // Password is not checked in this mock.
  return new Promise((resolve) => {
    setTimeout(() => {
      if (operatorName.trim() !== '') {
        if (typeof window !== 'undefined') {
          localStorage.setItem(AUTH_KEY, JSON.stringify({ loggedIn: true, operatorName }));
        }
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
    const authData = localStorage.getItem(AUTH_KEY);
    if (authData) {
      try {
        const parsedData = JSON.parse(authData);
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
    const authData = localStorage.getItem(AUTH_KEY);
    if (authData) {
      try {
        const parsedData = JSON.parse(authData);
        return parsedData.operatorName || null;
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}
