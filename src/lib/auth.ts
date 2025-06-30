
import { getOperatorsStore, type Operator } from './mock-data';

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
  return new Promise(async (resolve) => {
    // We get the latest operators from the store
    const mockOperators = await getOperatorsStore();
    
    // Find operator by first name (case-insensitive) and password.
    // NOTE: In a production environment, passwords MUST be hashed and salted, never stored in plain text.
    const operator = mockOperators.find(op => 
        op.nome.toLowerCase() === username.toLowerCase() && op.password === password_used
    );

    if (operator && typeof window !== 'undefined') {
      const authDataToStore: AuthData = { loggedIn: true, operatorId: operator.id };
      localStorage.setItem(AUTH_KEY, JSON.stringify(authDataToStore));
      resolve(true);
    } else {
      resolve(false);
    }
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
            // This part is tricky because it's a client-side function that needs server-side data.
            // For now, we assume the localStorage is the source of truth for the ID,
            // but fetching the full operator object would require an async call.
            // Let's create a temporary synchronous way for the client, assuming data hasn't changed.
            // A better approach would be to fetch this from the server.
            
            // This is a temporary solution for the sync nature of this function.
            // We can't call await getOperatorsStore() here directly.
            // A full solution would involve a client-side data cache or a server endpoint.
            // Since this is a mock, we will proceed, but this is a design flaw to fix in a real app.
            // Let's create a temporary sync fetch from local storage for the demo.
            const operatorsStr = localStorage.getItem('__mock_operators_cache');
            if (operatorsStr) {
                const operators = JSON.parse(operatorsStr) as Operator[];
                return operators.find(op => op.id === authData.operatorId) || null;
            }
            return null; // Operator data not cached
        }
    }
    return null;
}

// Client-side helper called on login to cache operators
export async function cacheOperatorsOnClient() {
    if (typeof window !== 'undefined') {
        const operators = await getOperatorsStore();
        localStorage.setItem('__mock_operators_cache', JSON.stringify(operators));
    }
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
