import { mockOperators, type Operator } from './mock-data';

const AUTH_KEY = 'prodtime_tracker_auth';

interface AuthData {
  loggedIn: boolean;
  operatorId: string;
}

function getAuthData(): AuthData | null {
  if (typeof window !== 'undefined') {
    const authDataString = localStorage.getItem(AUTH_KEY);
    if (authDataString) {
      try {
        return JSON.parse(authDataString) as AuthData;
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

export function login(username: string, password_used: string): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Find operator by first name. Assumes names are unique for login purposes.
      // TODO: In un ambiente di produzione, le password devono essere hashate e salate, mai memorizzate in chiaro.
      const operator = mockOperators.find(op => op.nome === username && op.password === password_used);

      if (operator && typeof window !== 'undefined') {
        const authDataToStore: AuthData = { loggedIn: true, operatorId: operator.id };
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
  const authData = getAuthData();
  return authData?.loggedIn === true;
}

export function getOperator(): Operator | null {
    if (typeof window !== 'undefined') {
        const authData = getAuthData();
        if (authData && authData.operatorId) {
            const operator = mockOperators.find(op => op.id === authData.operatorId);
            return operator || null;
        }
    }
    return null;
}

export function getOperatorName(): string | null {
  const operator = getOperator();
  return operator ? `${operator.nome} ${operator.cognome}` : null;
}

export function isAdmin(): boolean {
  const operator = getOperator();
  return operator?.role === 'admin';
}

export function isSuperadvisor(): boolean {
  const operator = getOperator();
  return operator?.role === 'superadvisor';
}
